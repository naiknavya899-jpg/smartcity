export default function StatusBadge({ status }) {
  const labels = {
    pending: 'Pending',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    rejected: 'Rejected',
    confirmed_fault: 'Confirmed Fault',
    field_inspection_required: 'Field Inspection Required',
    more_evidence_required: 'More Evidence Required',
  }
  const label = labels[status] || status?.replace(/_/g, ' ') || 'Unknown'
  return <span className={`badge badge-${status}`}>{label}</span>
}

