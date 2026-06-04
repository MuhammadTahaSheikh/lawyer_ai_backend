const ALL_STATUSES = [
    "New",
    "Open",
    "Assigned",
    "In Progress",
    "Pending",
    "Resolved",
    "Closed",
    "Cancelled",
    "Completed",
  ];
  
  const STATUS_TRANSITIONS = {
    New: ["Open", "Assigned", "Cancelled"],
    Open: ["Assigned", "In Progress", "Cancelled"],
    Assigned: ["In Progress", "Pending", "Cancelled"],
    "In Progress": ["Pending", "Resolved", "Cancelled"],
    Pending: ["In Progress", "Resolved", "Cancelled"],
    Resolved: ["Closed", "Completed"],
    Closed: [],
    Cancelled: [],
    Completed: [],
  };
  
  const ACTIVE_STATUSES = [
    "New",
    "Open",
    "Assigned",
    "In Progress",
    "Pending",
    "Resolved",
  ];
  
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
  const MAX_ATTACHMENTS = 5;
  const ALLOWED_MIME_PREFIXES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "text/plain",
    "image/png",
    "image/jpeg",
    "image/jpg",
  ];
  
  const parseJsonSafe = (value, fallback = null) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "object") return value;
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };
  
  const stripHtml = (html) =>
    String(html || "")
      .replace(/<[^>]+>/g, "")
      .trim();
  
  const mapRowToTicket = (row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    issue_type: row.issue_type,
    priority: row.priority,
    description: row.description,
    status: row.status,
    group_key: row.group_key || null,
    case_id: row.case_id || null,
    client_id: row.client_id || null,
    company_id: row.company_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    first_response_at: row.first_response_at,
    resolved_at: row.resolved_at,
    sla_first_due: row.sla_first_due,
    sla_resolve_due: row.sla_resolve_due,
    sla_first_status: row.sla_first_status || "ok",
    sla_resolve_status: row.sla_resolve_status || "ok",
    engineer: parseJsonSafe(row.engineer_json, null),
    createdBy: parseJsonSafe(row.created_by_json, null),
    attachments: parseJsonSafe(row.attachments_json, []),
    crmLink: parseJsonSafe(row.crm_link_json, null),
    templateData: parseJsonSafe(row.template_data_json, null),
  });
  
  const canTransition = (fromStatus, toStatus) => {
    const from = String(fromStatus || "Open").trim();
    const to = String(toStatus || "").trim();
    if (from === to) return true;
    const allowed = STATUS_TRANSITIONS[from];
    if (!allowed) return ALL_STATUSES.includes(to);
    return allowed.includes(to);
  };
  
  const validateAttachments = (attachments) => {
    if (!attachments) return [];
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length > MAX_ATTACHMENTS) {
      throw new Error(`Maximum ${MAX_ATTACHMENTS} attachments allowed.`);
    }
    for (const file of list) {
      const size = Number(file?.size || 0);
      if (size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `Attachment "${file?.name || "file"}" exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit.`
        );
      }
      const type = String(file?.type || "").toLowerCase();
      const allowed = ALLOWED_MIME_PREFIXES.some(
        (prefix) => type.startsWith(prefix) || type === "application/octet-stream"
      );
      const name = String(file?.name || "").toLowerCase();
      const extOk = /\.(pdf|doc|docx|txt|png|jpe?g)$/.test(name);
      if (!allowed && !extOk) {
        throw new Error(`File type not allowed: ${file?.name || "unknown"}`);
      }
      if (!file?.data || typeof file.data !== "string") {
        throw new Error(`Invalid attachment data for ${file?.name || "file"}`);
      }
    }
    return list;
  };
  
  const scanAttachments = async (attachments) => {
    validateAttachments(attachments);
    if (process.env.CLAMAV_URL) {
      const fetch = require("node-fetch");
      for (const file of attachments) {
        try {
          const res = await fetch(process.env.CLAMAV_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, data: file.data }),
            timeout: 15000,
          });
          const data = await res.json().catch(() => ({}));
          if (data?.infected) {
            throw new Error(`Virus detected in ${file.name}`);
          }
        } catch (err) {
          if (err.message?.includes("Virus detected")) throw err;
          console.warn("ClamAV scan skipped:", err.message);
        }
      }
    }
    return attachments;
  };
  
  const addBusinessHours = (startDate, hours) => {
    const d = new Date(startDate);
    let remaining = hours;
    while (remaining > 0) {
      d.setHours(d.getHours() + 1);
      const day = d.getDay();
      const hour = d.getHours();
      if (day >= 1 && day <= 5 && hour >= 9 && hour < 17) {
        remaining -= 1;
      }
    }
    return d;
  };
  
  const computeSlaDates = (priority, createdAt = new Date()) => {
    const map = {
      Low: { first: 24, resolve: 120 },
      Medium: { first: 8, resolve: 48 },
      High: { first: 4, resolve: 24 },
      Critical: { first: 1, resolve: 8 },
    };
    const cfg = map[priority] || map.Medium;
    return {
      sla_first_due: addBusinessHours(createdAt, cfg.first),
      sla_resolve_due: addBusinessHours(createdAt, cfg.resolve),
    };
  };
  
  const computeSlaStatus = (dueDate, completedAt) => {
    if (completedAt) return "ok";
    if (!dueDate) return "ok";
    const due = new Date(dueDate);
    const now = new Date();
    if (now > due) return "breached";
    const hoursLeft = (due - now) / (1000 * 60 * 60);
    if (hoursLeft <= 2) return "at_risk";
    return "ok";
  };
  
  const statusSortCase = `
    CASE status
      WHEN 'New' THEN 1
      WHEN 'Open' THEN 2
      WHEN 'Assigned' THEN 3
      WHEN 'In Progress' THEN 4
      WHEN 'Pending' THEN 5
      WHEN 'Resolved' THEN 6
      WHEN 'Completed' THEN 7
      WHEN 'Closed' THEN 8
      WHEN 'Cancelled' THEN 9
      ELSE 10
    END
  `;
  
  module.exports = {
    ALL_STATUSES,
    STATUS_TRANSITIONS,
    ACTIVE_STATUSES,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS,
    parseJsonSafe,
    stripHtml,
    mapRowToTicket,
    canTransition,
    validateAttachments,
    scanAttachments,
    computeSlaDates,
    computeSlaStatus,
    statusSortCase,
  };
  