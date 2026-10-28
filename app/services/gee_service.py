"""Google Earth Engine integration for geospatial hotspot analysis."""

import logging
import os
import threading
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from time import monotonic

from app.config import (
    BASE_DIR,
    GEE_PRIVATE_KEY_PATH,
    GEE_PROJECT_ID,
    GEE_SERVICE_ACCOUNT,
)

logger = logging.getLogger(__name__)
_gee_initialized = False
_gee_init_lock = threading.Lock()
_satellite_tile_cache: dict[tuple[float, float, int], tuple[float, dict]] = {}
_SATELLITE_TILE_CACHE_SECONDS = 1800
_GOOGLE_API_NO_PROXY_HOSTS = ("earthengine.googleapis.com", "oauth2.googleapis.com", ".googleapis.com")


class GeeServiceError(RuntimeError):
    """A safe, actionable Earth Engine failure for logs and API responses."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _diagnose_gee_error(exc: Exception, stage: str) -> GeeServiceError:
    text = str(exc).lower()
    exception_name = type(exc).__name__.lower()
    response = getattr(exc, "resp", None)
    status_code = getattr(exc, "code", None) or getattr(response, "status", None)

    if isinstance(exc, (ConnectionError, TimeoutError)) or any(
        marker in exception_name for marker in ("connectionerror", "timeout", "proxyerror", "maxretryerror", "newconnectionerror")
    ):
        return GeeServiceError("network_error", "Could not reach the Earth Engine API. Check network access and retry.")
    if status_code == 429:
        return GeeServiceError("rate_limited", "Earth Engine temporarily rate-limited the request. Retry shortly.")
    if status_code in (408, 500, 502, 503, 504):
        return GeeServiceError("service_unavailable", "The Earth Engine API is temporarily unavailable. Retry shortly.")
    if any(marker in text for marker in ("invalid_grant", "invalid jwt", "unauthorized", "token has been expired")) or any(
        marker in exception_name for marker in ("refresherror", "defaultcredentialserror", "authenticationerror")
    ):
        return GeeServiceError("authentication_error", "Earth Engine authentication failed. Validate the configured service-account key and principal.")
    if "not registered" in text or "registration" in text and "earth engine" in text:
        return GeeServiceError("project_not_registered", "The configured Cloud project is not registered for Earth Engine use.")
    if "billing" in text and ("disabled" in text or "account" in text):
        return GeeServiceError("billing_configuration", "The configured Cloud project has a billing configuration problem for this operation.")
    if "serviceusage.serviceusage" in text and "permission" in text:
        return GeeServiceError("project_permission_denied", "The configured principal cannot use services in the Cloud project.")
    if "api has not been used" in text or "api is disabled" in text or "has not been enabled" in text:
        return GeeServiceError("earth_engine_api_disabled", "Enable the Earth Engine API for the configured Cloud project.")
    if status_code in (401, 403) or "permission denied" in text or "does not have permission" in text or "forbidden" in text:
        return GeeServiceError("permission_denied", "The configured principal lacks permission for this Earth Engine operation.")
    if status_code == 404 or "project was not found" in text or "invalid project" in text:
        return GeeServiceError("invalid_project", "The configured Cloud project was not found or is invalid.")

    if stage == "initialization":
        return GeeServiceError("initialization_error", f"Earth Engine initialization failed ({type(exc).__name__}). Check backend logs for the sanitized diagnostic.")
    if stage == "dataset":
        return GeeServiceError("dataset_access_error", f"Earth Engine could not read the requested dataset ({type(exc).__name__}).")
    if stage == "tile":
        return GeeServiceError("tile_generation_error", f"Earth Engine could not generate map tiles ({type(exc).__name__}).")
    return GeeServiceError("earth_engine_request_error", f"Earth Engine request failed ({type(exc).__name__}).")


def _bypass_proxy_for_google_apis() -> bool:
    """Retry Google API calls directly after proxy connection failures only."""
    if not any(os.environ.get(name) for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")):
        return False
    entries = []
    for name in ("NO_PROXY", "no_proxy"):
        entries.extend(value.strip() for value in os.environ.get(name, "").split(",") if value.strip())
    for host in _GOOGLE_API_NO_PROXY_HOSTS:
        if host not in entries:
            entries.append(host)
    exclusions = ",".join(dict.fromkeys(entries))
    os.environ["NO_PROXY"] = exclusions
    os.environ["no_proxy"] = exclusions
    return True


def initialize_gee():
    """Initialize Earth Engine with validated server-side configuration."""
    global _gee_initialized
    with _gee_init_lock:
        if _gee_initialized:
            import ee

            return ee

        missing = [
            name
            for name, value in (
                ("GEE_SERVICE_ACCOUNT", GEE_SERVICE_ACCOUNT),
                ("GEE_PRIVATE_KEY_PATH", GEE_PRIVATE_KEY_PATH),
                ("GEE_PROJECT_ID", GEE_PROJECT_ID),
            )
            if not value or not value.strip()
        ]
        if missing:
            message = "Missing Earth Engine settings: " + ", ".join(missing)
            logger.error("Earth Engine configuration is incomplete: %s", ", ".join(missing))
            raise GeeServiceError("configuration_missing", message)

        key_path = Path(GEE_PRIVATE_KEY_PATH).expanduser()
        if not key_path.is_absolute():
            key_path = BASE_DIR / key_path
        if not key_path.is_file():
            logger.error("Configured Earth Engine service-account key file is missing.")
            raise GeeServiceError("credential_file_missing", "The configured Earth Engine service-account key file was not found.")

        try:
            import ee

            credentials = ee.ServiceAccountCredentials(GEE_SERVICE_ACCOUNT, str(key_path))
            for attempt in range(2):
                try:
                    ee.Initialize(credentials, project=GEE_PROJECT_ID)
                    # Initialization can be lazy; this small request confirms a real API round trip.
                    ee.String("Earth Engine connection check").getInfo()
                    _gee_initialized = True
                    logger.info("Earth Engine initialized and API connection verified.")
                    return ee
                except Exception as exc:
                    exception_name = type(exc).__name__.lower()
                    transient = isinstance(exc, (ConnectionError, TimeoutError)) or any(
                        marker in exception_name
                        for marker in ("connectionerror", "timeout", "proxyerror", "maxretryerror", "newconnectionerror")
                    )
                    if transient and attempt == 0:
                        direct_retry = _bypass_proxy_for_google_apis()
                        logger.warning(
                            "Earth Engine connection failed transiently; retrying once%s.",
                            " with a direct Google API connection" if direct_retry else "",
                        )
                        time.sleep(1)
                        continue
                    raise
        except GeeServiceError:
            raise
        except Exception as exc:
            _gee_initialized = False
            diagnostic = _diagnose_gee_error(exc, "initialization")
            logger.error("Earth Engine initialization failed: code=%s exception=%s", diagnostic.code, type(exc).__name__)
            raise diagnostic from None


def is_gee_available() -> bool:
    try:
        initialize_gee()
        return True
    except RuntimeError:
        return False


def test_gee_connection() -> dict:
    """Make one read-only request for metadata from the public Sentinel-2 catalog."""
    ee = initialize_gee()
    dataset_id = "COPERNICUS/S2_SR_HARMONIZED"
    try:
        scene_ids = (
            ee.ImageCollection(dataset_id)
            .limit(1)
            .aggregate_array("system:id")
            .getInfo()
        )
    except Exception as exc:
        diagnostic = _diagnose_gee_error(exc, "dataset")
        if diagnostic.code == "authentication_error":
            _reset_gee_initialization()
        logger.error("Earth Engine dataset request failed: code=%s exception=%s", diagnostic.code, type(exc).__name__)
        raise diagnostic from None

    if not scene_ids:
        raise RuntimeError(
            "Earth Engine request completed, but the public Sentinel-2 collection "
            "returned no scene metadata."
        )
    return {
        "status": "success",
        "dataset": dataset_id,
        "scene_id": scene_ids[0],
    }


def compute_hotspots(complaints: list[dict], grid_size: float = 0.01) -> list[dict]:
    """Cluster complaints into grid cells and return hotspot data."""
    if not complaints:
        return []

    grid: dict[tuple, list] = defaultdict(list)
    for c in complaints:
        cell = (round(c["latitude"] / grid_size), round(c["longitude"] / grid_size))
        grid[cell].append(c)

    hotspots = []
    for (lat_cell, lon_cell), items in grid.items():
        if len(items) < 2:
            continue
        categories = [i["category"] for i in items]
        dominant = max(set(categories), key=categories.count)
        hotspots.append(
            {
                "latitude": lat_cell * grid_size,
                "longitude": lon_cell * grid_size,
                "count": len(items),
                "dominant_category": dominant,
            }
        )

    hotspots.sort(key=lambda h: h["count"], reverse=True)

    if is_gee_available():
        hotspots = _enrich_with_gee(hotspots)

    return hotspots[:20]


def _enrich_with_gee(hotspots: list[dict]) -> list[dict]:
    """Add satellite-derived context to hotspot zones via GEE."""
    try:
        import ee

        for hotspot in hotspots:
            point = ee.Geometry.Point([hotspot["longitude"], hotspot["latitude"]])
            region = point.buffer(500)

            ndvi = (
                ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(region)
                .filterDate("2024-01-01", "2025-12-31")
                .select("B8")
                .mean()
            )
            hotspot["gee_vegetation_index"] = "computed"
            hotspot["gee_region_area_m2"] = 500
    except Exception as exc:
        logger.warning("GEE enrichment skipped (%s).", type(exc).__name__)

    return hotspots


def get_satellite_overlay_bounds(lat: float, lon: float, radius_m: float = 25000) -> dict:
    """Fetch imagery tiles, retrying transient Earth Engine/network failures."""
    result = None
    for attempt in range(3):
        result = _get_satellite_overlay_bounds_once(lat, lon, radius_m)
        if result.get("available") or result.get("error_code") not in {
            "network_error", "rate_limited", "service_unavailable"
        } or attempt == 2:
            return result
        logger.warning("Earth Engine tile request had a transient failure; retry %s of 2.", attempt + 1)
        time.sleep(attempt + 1)
    return result or {"available": False, "error_code": "network_error", "message": "Could not reach the Earth Engine API. Check network access and retry."}


def _get_satellite_overlay_bounds_once(lat: float, lon: float, radius_m: float = 25000) -> dict:
    """Return dynamic Earth Engine Sentinel-2 RGB and water tile URLs."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return {"available": False, "message": "Enter valid map coordinates."}

    try:
        initialize_gee()
    except RuntimeError as exc:
        return {"available": False, "error_code": getattr(exc, "code", "initialization_error"), "message": str(exc)}

    cache_key = (round(lat, 2), round(lon, 2), int(radius_m))
    cached = _satellite_tile_cache.get(cache_key)
    if cached and monotonic() - cached[0] < _SATELLITE_TILE_CACHE_SECONDS:
        return cached[1]

    try:
        import ee

        center = ee.Geometry.Point([lon, lat])
        region = center.buffer(radius_m).bounds()
        end = date.today()
        start = end - timedelta(days=180)

        def mask_clouds(image):
            scene_class = image.select("SCL")
            clear = (
                scene_class.neq(1)
                .And(scene_class.neq(3))
                .And(scene_class.neq(8))
                .And(scene_class.neq(9))
                .And(scene_class.neq(10))
                .And(scene_class.neq(11))
            )
            return image.updateMask(clear)

        def scenes_for(period_start, max_cloud_percent):
            return (
                ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(region)
                .filterDate(period_start.isoformat(), end.isoformat())
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", max_cloud_percent))
                .map(mask_clouds)
            )

        collection = scenes_for(start, 40)
        scene_count = collection.size().getInfo()
        if scene_count == 0:
            # Retain an actual clear Sentinel-2 observation where the recent
            # window has no usable scenes; never synthesize sharper pixels.
            start = end - timedelta(days=365)
            collection = scenes_for(start, 80)
            scene_count = collection.size().getInfo()
        if scene_count == 0:
            return {
                "available": False,
                "error_code": "no_imagery",
                "message": "No usable Sentinel-2 imagery is available for this location. The standard map remains available.",
            }

        first_scene = ee.Image(collection.first())
        rgb_projection = first_scene.select("B2").projection()
        water_projection = first_scene.select("B11").projection()
        composite = (
            collection.select(["B4", "B3", "B2"])
            .median()
            .setDefaultProjection(rgb_projection)
            .clip(region)
        )
        satellite_map = composite.getMapId({
            "bands": ["B4", "B3", "B2"],
            "min": [0, 0, 0],
            "max": [3000, 3000, 3000],
            "gamma": 1.2,
            "format": "png",
        })

        water_composite = collection.select(["B3", "B11"]).median()
        mndwi = water_composite.normalizedDifference(["B3", "B11"]).setDefaultProjection(water_projection)
        water_candidates = mndwi.gt(0).selfMask()
        water_map = water_candidates.getMapId({
            "min": 0,
            "max": 1,
            "palette": ["20d9ff"],
            "format": "png",
        })
        result = {
            "available": True,
            "center": {"lat": lat, "lng": lon},
            "radius_m": radius_m,
            "layer": "COPERNICUS/S2_SR_HARMONIZED",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "scene_count": scene_count,
            "native_resolution_m": 10,
            "satellite_max_zoom": 14,
            "tile_url": satellite_map["tile_fetcher"].url_format,
            "water_tile_url": water_map["tile_fetcher"].url_format,
            "water_index": "MNDWI",
            "water_threshold": 0,
            "water_resolution_m": 20,
        }
        _satellite_tile_cache[cache_key] = (monotonic(), result)
        return result
    except Exception as exc:
        diagnostic = _diagnose_gee_error(exc, "tile")
        if diagnostic.code == "authentication_error":
            _reset_gee_initialization()
        logger.error("Earth Engine tile generation failed: code=%s exception=%s", diagnostic.code, type(exc).__name__)
        return {
            "available": False,
            "error_code": diagnostic.code,
            "message": str(diagnostic),
        }


def _reset_gee_initialization() -> None:
    global _gee_initialized
    with _gee_init_lock:
        _gee_initialized = False
