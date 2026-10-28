// Add a real tutorial MP4 under frontend/public/videos and set videoSrc to
// its public URL when one is available. The existing logo animation is not a tutorial.
export const ASSISTANT_TUTORIALS = [
  {
    id: 'report',
    title: 'Report a city problem',
    videoSrc: null,
    steps: ['Open Report an Issue from the dashboard.', 'Enter a short title, description, and problem address.', 'Attach a photo and an MP4 video of the problem.', 'Choose the problem location on the map, then submit the report.'],
  },
  {
    id: 'location',
    title: 'Set the problem location',
    videoSrc: null,
    steps: ['In the report form, search for the address or area.', 'Tap the map to place the report marker at the problem.', 'Allow browser location access if you choose current location.', 'Check the marker before submitting.'],
  },
  {
    id: 'photo',
    title: 'Add a problem photo',
    videoSrc: null,
    steps: ['In the report form, choose Take a photo or Choose from gallery.', 'Select a clear image that shows the issue and nearby context.', 'A photo is required before you can submit the report.'],
  },
  {
    id: 'status',
    title: 'Check complaint status',
    videoSrc: null,
    steps: ['Find the numeric complaint ID in My Complaints.', 'Choose Track My Complaint in this chat.', 'Enter the ID, such as #5, to retrieve the latest saved status.'],
  },
  {
    id: 'dashboard',
    title: 'Use the Urban Eye dashboard',
    videoSrc: null,
    steps: ['Open your citizen dashboard after signing in.', 'Use its report and complaint sections to submit issues and view your reports.', 'Open Civique from the floating assistant button for help.'],
  },
]
