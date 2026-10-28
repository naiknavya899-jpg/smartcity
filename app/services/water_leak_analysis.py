from datetime import date, timedelta
import logging
from statistics import median

from app.services.gee_service import GeeServiceError, _diagnose_gee_error, _reset_gee_initialization, initialize_gee

logger = logging.getLogger(__name__)


def analyze_water_leak(lat: float, lon: float, radius_m: int, start_date: date, end_date: date) -> dict:
    """Conservative multi-sensor surface anomaly screening; never diagnoses pipe leaks."""
    try:
        ee = initialize_gee()
        region = ee.Geometry.Point([lon, lat]).buffer(radius_m)
        baseline_start = start_date - timedelta(days=365)
        baseline_end = end_date - timedelta(days=365)
        end_exclusive = end_date + timedelta(days=1)
        s1 = (ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(region)
              .filterDate(baseline_start.isoformat(), end_exclusive.isoformat())
              .filter(ee.Filter.eq('instrumentMode', 'IW'))
              .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
              .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH')))
        passes = s1.aggregate_array('orbitProperties_pass').distinct().getInfo() or []
        candidates = []
        for orbit in passes:
            col = s1.filter(ee.Filter.eq('orbitProperties_pass', orbit)).sort('system:time_start')
            count = col.size().getInfo()
            if count:
                candidates.append((count, orbit, col))
        s1_count, orbit, s1 = max(candidates, default=(0, None, None), key=lambda x: x[0])
        if s1_count and not {'VV', 'VH'}.issubset(set(ee.Image(s1.first()).bandNames().getInfo())):
            raise RuntimeError('Sentinel-1 collection is missing required VV/VH bands.')

        def cloud_mask(image):
            scl = image.select('SCL')
            clear = (scl.neq(0).And(scl.neq(1)).And(scl.neq(3)).And(scl.neq(8))
                     .And(scl.neq(9)).And(scl.neq(10)).And(scl.neq(11)))
            return image.updateMask(clear)

        s2 = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(region)
              .filterDate(baseline_start.isoformat(), end_exclusive.isoformat())
              .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 80)).map(cloud_mask))
        s2_count = s2.size().getInfo()
        if s2_count and not {'B3', 'B4', 'B8', 'B11', 'SCL'}.issubset(set(ee.Image(s2.first()).bandNames().getInfo())):
            raise RuntimeError('Sentinel-2 collection is missing required analysis bands.')
        chirps = (ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterBounds(ee.Geometry.Point([lon, lat]))
                  .filterDate(baseline_start.isoformat(), end_exclusive.isoformat()).select('precipitation'))
        rain_count = chirps.size().getInfo()
        rain_rows = []
        if rain_count:
            rain_rows = chirps.map(lambda image: ee.Feature(None, {
                'date': ee.Date(image.get('system:time_start')).format('YYYY-MM-dd'),
                'mm': image.reduceRegion(ee.Reducer.first(), ee.Geometry.Point([lon, lat]), 5566, maxPixels=100).get('precipitation')
            })).getInfo().get('features', [])
        rain = {f['properties']['date']: f['properties'].get('mm') for f in rain_rows if f.get('properties', {}).get('mm') is not None}

        def observations(collection, bands, scale, index_fn=None):
            if collection is None:
                return []
            def row(image):
                img = index_fn(image) if index_fn else image
                stats = img.select(bands).reduceRegion(ee.Reducer.mean(), region, scale, maxPixels=100000)
                return ee.Feature(None, stats.set('date', ee.Date(image.get('system:time_start')).format('YYYY-MM-dd')))
            features = collection.map(row).getInfo().get('features', [])
            # Sentinel granules can overlap on the same calendar day. Count a
            # date once so overlap is never mistaken for repeat observations.
            daily = {}
            for feature in features:
                properties = feature['properties']
                day = properties['date']
                if day not in daily:
                    daily[day] = {key: [] for key in bands}
                for key in bands:
                    if properties.get(key) is not None:
                        daily[day][key].append(float(properties[key]))
            return [{'date': day, **{key: sum(vals) / len(vals) for key, vals in values.items() if vals}}
                    for day, values in sorted(daily.items())]

        s1_rows = observations(s1, ['VV', 'VH'], 10)
        def indices(img):
            ndmi = img.normalizedDifference(['B8', 'B11']).rename('NDMI')
            ndwi = img.normalizedDifference(['B3', 'B8']).rename('NDWI')
            ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI')
            return img.addBands([ndmi, ndwi, ndvi])
        s2_rows = observations(s2, ['NDMI', 'NDWI', 'NDVI'], 20, indices)

        def rain3(obs):
            day = date.fromisoformat(obs['date'])
            vals = [rain.get((day - timedelta(days=i)).isoformat()) for i in (0, 1, 2)]
            return sum(vals) if all(v is not None for v in vals) else None
        def dry(rows):
            return [r for r in rows if rain3(r) is not None and rain3(r) <= 5]
        baseline_s1 = [r for r in s1_rows if baseline_start.isoformat() <= r['date'] <= baseline_end.isoformat()]
        target_s1 = [r for r in s1_rows if start_date.isoformat() <= r['date'] <= end_date.isoformat()]
        baseline_s2 = [r for r in s2_rows if baseline_start.isoformat() <= r['date'] <= baseline_end.isoformat()]
        target_s2 = [r for r in s2_rows if start_date.isoformat() <= r['date'] <= end_date.isoformat()]
        b1, t1, b2, t2 = map(dry, (baseline_s1, target_s1, baseline_s2, target_s2))
        availability = {
            'sentinel1': {'dataset': 'COPERNICUS/S1_GRD', 'orbit_pass': orbit, 'baseline_observations': len(b1), 'period_observations': len(t1), 'baseline_dates': [r['date'] for r in b1], 'valid_dates': [r['date'] for r in t1]},
            'sentinel2': {'dataset': 'COPERNICUS/S2_SR_HARMONIZED', 'baseline_observations': len(b2), 'period_observations': len(t2), 'baseline_dates': [r['date'] for r in b2], 'valid_dates': [r['date'] for r in t2]},
            'rainfall': {'dataset': 'UCSB-CHG/CHIRPS/DAILY', 'valid_daily_records': len(rain), 'pixel_resolution_m': 5566, 'available_dates': sorted(rain)[-10:]},
        }
        reasons = []
        if len(b1) < 5 or len(t1) < 2: reasons.append('Need at least 5 dry baseline and 2 dry-period Sentinel-1 observations.')
        if len(b2) < 3 or len(t2) < 2: reasons.append('Need at least 3 dry baseline and 2 dry-period cloud-free Sentinel-2 observations.')
        if len(rain) < 10: reasons.append('Rainfall context is missing or too sparse for the observation dates.')
        result = {
            'center': {'lat': lat, 'lng': lon}, 'radius_m': radius_m,
            'date_range': {'start': start_date.isoformat(), 'end': end_date.isoformat()},
            'baseline_range': {'start': baseline_start.isoformat(), 'end': baseline_end.isoformat()},
            'availability': availability,
            'spatial_resolution': {'sentinel1_m': 10, 'sentinel2_ndmi_m': 20, 'rainfall_m': 5566},
            'limitations': 'This screens persistent surface moisture/backscatter changes; 10–20 m pixels and coarse rainfall cannot resolve or confirm an individual underground pipe leak.',
            'overlay_tile_url': '', 'suspicious_areas': {'type': 'FeatureCollection', 'features': []}, 'suspicious_area_count': 0,
            'indicator_values': {},
            'outcome': 'Insufficient data' if reasons else 'No significant anomaly detected',
            'insufficient_data_reasons': reasons,
            'disclaimer': 'Neither outcome independently confirms or rules out an underground pipe leak.'
        }
        if reasons:
            result['alternative_data_source'] = 'Inspect utility acoustic correlators and pressure/flow loggers, municipal leak reports, and conduct a field survey.'
            return result

        def mean(rows, key): return median(float(r[key]) for r in rows if r.get(key) is not None)
        vv_delta = mean(t1, 'VV') - mean(b1, 'VV')
        vh_delta = mean(t1, 'VH') - mean(b1, 'VH')
        ndmi_delta = mean(t2, 'NDMI') - mean(b2, 'NDMI')
        ndwi_delta = mean(t2, 'NDWI') - mean(b2, 'NDWI')
        ndvi_delta = mean(t2, 'NDVI') - mean(b2, 'NDVI')
        result['indicator_values'] = {'sentinel1_vv_change_db': round(vv_delta, 2), 'sentinel1_vh_change_db': round(vh_delta, 2), 'sentinel2_ndmi_change': round(ndmi_delta, 3), 'sentinel2_ndwi_change': round(ndwi_delta, 3), 'sentinel2_ndvi_change': round(ndvi_delta, 3), 'dry_observation_rule': '3-day CHIRPS rainfall <= 5 mm'}
        result['screening_thresholds'] = {'absolute_sentinel1_vv_change_db': 3, 'sentinel2_ndmi_or_ndwi_increase': 0.12, 'minimum_connected_20m_pixels': 4, 'minimum_baseline_period_observations': {'sentinel1': 5, 'sentinel2': 3}, 'minimum_target_period_observations': 2}
        # Use the screened acquisition dates for spatial medians; keep each input collection
        # on its source grid and evaluate the combined result at Sentinel-2's 20 m NDMI grid.
        if abs(vv_delta) >= 3 and (ndmi_delta >= 0.12 or ndwi_delta >= 0.12):
            base_s1_days = [r['date'] for r in b1]
            target_s1_days = [r['date'] for r in t1]
            base_s2_days = [r['date'] for r in b2]
            target_s2_days = [r['date'] for r in t2]
            s1_tagged = s1.map(lambda image: image.set('day', ee.Date(image.get('system:time_start')).format('YYYY-MM-dd')))
            s2_tagged = s2.map(lambda image: image.set('day', ee.Date(image.get('system:time_start')).format('YYYY-MM-dd')))
            base_radar = s1_tagged.filter(ee.Filter.inList('day', base_s1_days)).select('VV').median()
            period_radar = s1_tagged.filter(ee.Filter.inList('day', target_s1_days)).select('VV').median()
            base_optical = s2_tagged.filter(ee.Filter.inList('day', base_s2_days)).map(indices).median()
            period_optical = s2_tagged.filter(ee.Filter.inList('day', target_s2_days)).map(indices).median()
            radar_change = period_radar.subtract(base_radar).abs().gt(3)
            optical_change = period_optical.select('NDMI').subtract(base_optical.select('NDMI')).gt(0.12).Or(
                period_optical.select('NDWI').subtract(base_optical.select('NDWI')).gt(0.12)
            )
            projection = ee.Image(s2.first()).select('B11').projection()
            candidate = (radar_change.And(optical_change).selfMask()
                         .setDefaultProjection(projection)
                         .connectedPixelCount(100, True).gte(4).selfMask()
                         .rename('potential_surface_wetness_change').clip(region))
            vis = candidate.getMapId({'min': 1, 'max': 1, 'palette': ['ef4444']})
            vectors = candidate.reduceToVectors(
                geometry=region, scale=20, crs=projection, geometryType='polygon',
                eightConnected=True, labelProperty='class', reducer=ee.Reducer.countEvery(),
                maxPixels=1000000, tileScale=4
            )
            result['suspicious_area_count'] = vectors.size().getInfo()
            vectors = vectors.limit(50)
            result['overlay_tile_url'] = vis['tile_fetcher'].url_format
            vectors = vectors.map(lambda feature: feature.set({
                'area_m2': feature.geometry().area(1),
                'centroid': feature.geometry().centroid(1).coordinates(),
                'radar_vv_change_db': vv_delta,
                'optical_ndmi_change': ndmi_delta,
                'optical_ndwi_change': ndwi_delta,
                'dry_period_s1_observations': len(t1),
                'dry_period_s2_observations': len(t2),
            }))
            result['suspicious_areas'] = vectors.getInfo()
            result['outcome'] = 'Potential anomaly detected' if result['suspicious_area_count'] else 'No significant anomaly detected'
            result['evidence_summary'] = f'Areas shown overlap a >3 dB Sentinel-1 VV change with a >0.12 increase in Sentinel-2 NDMI or NDWI, using dry-weather date composites and repeated observations. NDVI changed by {ndvi_delta:.3f}; vegetation phenology may affect interpretation.'
        else:
            result['evidence_summary'] = f'The available dry-weather aggregate indicators did not pass the conservative screening thresholds. NDVI baseline-to-period change was {ndvi_delta:.3f}; vegetation and seasonal conditions remain interpretation limits.'
        result['alternative_data_source'] = 'Field inspection with acoustic leak correlator and pressure/flow logging is recommended.'
        return result
    except GeeServiceError:
        raise
    except Exception as exc:
        diagnostic = _diagnose_gee_error(exc, 'analysis')
        if diagnostic.code == 'authentication_error':
            _reset_gee_initialization()
        logger.error('Water leak analysis failed: code=%s exception=%s', diagnostic.code, type(exc).__name__)
        raise diagnostic from None












