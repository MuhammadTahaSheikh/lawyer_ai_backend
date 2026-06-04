const fetch = require("node-fetch");
const db = require("../db");
const { parseJsonSafe } = require("./ticketHelpers");

const EVENT_CONFIG = {
  ticket_created: {
    title: (t) => `New ticket #${t.id}`,
    themeColor: "0078D4",
    emailSubject: (t) => `[Ticket #${t.id}] New: ${t.subject}`,
  },
  ticket_assigned: {
    title: (t) => `Ticket #${t.id} assigned to you`,
    themeColor: "0078D4",
    emailSubject: (t) => `[Ticket #${t.id}] Assigned: ${t.subject}`,
  },
  status_changed: {
    title: (t) => `Ticket #${t.id} → ${t.status}`,
    themeColor: "FF8C00",
    emailSubject: (t) => `[Ticket #${t.id}] Status: ${t.status}`,
  },
  comment_added: {
    title: (t) => `New comment on ticket #${t.id}`,
    themeColor: "6264A7",
    emailSubject: (t) => `[Ticket #${t.id}] New comment`,
  },
  ticket_resolved: {
    title: (t) => `Ticket #${t.id} resolved`,
    themeColor: "107C10",
    emailSubject: (t) => `[Ticket #${t.id}] Resolved — please review`,
  },
};

const getTicketAppUrl = () =>
  (process.env.TICKET_APP_URL || process.env.CMS_APP_URL || "https://cms.louislawgroup.com").replace(
    /\/$/,
    ""
  );

const ticketDeepLink = (ticketId) => `${getTicketAppUrl()}/submit?ticket=${ticketId}`;

const buildNotificationPayload = (ticket, eventType, actorUid, extra = {}) => {
  const engineer = ticket.engineer || parseJsonSafe(ticket.engineer_json, null);
  const createdBy = ticket.createdBy || parseJsonSafe(ticket.created_by_json, null);
  const cfg = EVENT_CONFIG[eventType] || {
    title: (t) => `Ticket #${t.id} updated`,
    themeColor: "0078D4",
    emailSubject: (t) => `[Ticket #${t.id}] Update`,
  };

  const requesterEmail = ticket.email || createdBy?.email || "";
  const assigneeEmail = engineer?.email || "";
  const requesterUid = createdBy?.id ? String(createdBy.id) : null;
  const assigneeUid = engineer?.id ? String(engineer.id) : null;

  const recipientUids = new Set();
  const recipientEmails = new Set();
  const actor = actorUid ? String(actorUid) : "";
  if (requesterUid && String(requesterUid) !== actor) recipientUids.add(String(requesterUid));
  if (assigneeUid && String(assigneeUid) !== actor) recipientUids.add(String(assigneeUid));
  if (requesterEmail) recipientEmails.add(requesterEmail);
  if (assigneeEmail) recipientEmails.add(assigneeEmail);

  const title = cfg.title(ticket);
  const ticketUrl = ticketDeepLink(ticket.id);
  const summaryLine = `${ticket.priority} · ${ticket.issue_type} · ${ticket.status}`;

  const htmlBody = `
    <h2>${title}</h2>
    <p><strong>Subject:</strong> ${ticket.subject || "—"}</p>
    <p><strong>Status:</strong> ${ticket.status}</p>
    <p><strong>Priority:</strong> ${ticket.priority}</p>
    <p><strong>Type:</strong> ${ticket.issue_type}</p>
    <p><strong>Requester:</strong> ${ticket.name} (${requesterEmail})</p>
    <p><strong>Assignee:</strong> ${engineer?.name || ticket.group_key || "Unassigned"}</p>
    ${extra.commentPreview ? `<p><strong>Comment:</strong> ${extra.commentPreview}</p>` : ""}
    <p><a href="${ticketUrl}">Open ticket in CMS</a></p>
  `.trim();

  const textBody = [
    title,
    `Subject: ${ticket.subject}`,
    `Status: ${ticket.status} | Priority: ${ticket.priority} | Type: ${ticket.issue_type}`,
    `Requester: ${ticket.name} <${requesterEmail}>`,
    `Assignee: ${engineer?.name || ticket.group_key || "Unassigned"}`,
    extra.commentPreview ? `Comment: ${extra.commentPreview}` : "",
    `Open: ${ticketUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    eventType,
    ticketId: ticket.id,
    title,
    subject: cfg.emailSubject(ticket),
    summaryLine,
    textBody,
    htmlBody,
    ticketUrl,
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      issueType: ticket.issue_type,
      requesterName: ticket.name,
      requesterEmail,
      assigneeName: engineer?.name || null,
      assigneeEmail: assigneeEmail || null,
      groupKey: ticket.group_key || null,
    },
    recipientUids: [...recipientUids],
    recipientEmails: [...recipientEmails],
    teamsNotifyChannel: process.env.TEAMS_NOTIFY_CHANNEL || "IT Support",
    timestamp: new Date().toISOString(),
    ...extra,
  };
};

const buildTeamsMessageCard = (payload) => ({
  "@type": "MessageCard",
  "@context": "http://schema.org/extensions",
  themeColor: (EVENT_CONFIG[payload.eventType] || {}).themeColor || "0078D4",
  summary: payload.title,
  sections: [
    {
      activityTitle: payload.title,
      activitySubtitle: payload.summaryLine,
      facts: [
        { name: "Ticket", value: `#${payload.ticketId}` },
        { name: "Subject", value: payload.ticket.subject || "—" },
        { name: "Status", value: payload.ticket.status },
        { name: "Requester", value: `${payload.ticket.requesterName} (${payload.ticket.requesterEmail})` },
        {
          name: "Assignee",
          value: payload.ticket.assigneeName || payload.ticket.groupKey || "Unassigned",
        },
      ],
      markdown: true,
    },
  ],
  potentialAction: [
    {
      "@type": "OpenUri",
      name: "View ticket",
      targets: [{ os: "default", uri: payload.ticketUrl }],
    },
  ],
});

const createInAppNotification = async ({ userUid, ticketId, eventType, title, body }) => {
  if (!userUid) return;
  try {
    await db.promise().query(
      `INSERT INTO ticket_notifications (user_uid, ticket_id, event_type, title, body)
       VALUES (?, ?, ?, ?, ?)`,
      [userUid, ticketId, eventType, title, body || null]
    );
  } catch (err) {
    console.warn("In-app notification insert failed:", err.message);
  }
};

const postJson = async (url, body, label) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
};

const sendTeamsMessageCard = async (payload) => {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) return { skipped: true, reason: "TEAMS_WEBHOOK_URL not set" };
  const card = buildTeamsMessageCard(payload);
  await postJson(url, card, "Teams");
  return { ok: true };
};

const sendEmailViaWebhook = async (payload) => {
  const url = process.env.TICKET_EMAIL_WEBHOOK_URL;
  if (!url) return { skipped: true, reason: "TICKET_EMAIL_WEBHOOK_URL not set" };

  const results = [];
  for (const to of payload.recipientEmails) {
    await postJson(
      url,
      {
        to,
        subject: payload.subject,
        body: payload.textBody,
        html: payload.htmlBody,
        ticketId: payload.ticketId,
        eventType: payload.eventType,
        ticketUrl: payload.ticketUrl,
      },
      "Email webhook"
    );
    results.push(to);
  }
  return { ok: true, sent: results };
};

const sendN8nTicketWebhook = async (payload) => {
  const url = process.env.N8N_TICKET_WEBHOOK_URL || process.env.N8N_TICKET_NOTIFY_URL;
  if (!url) return { skipped: true, reason: "N8N_TICKET_WEBHOOK_URL not set" };
  await postJson(url, payload, "n8n ticket");
  return { ok: true };
};

/**
 * Send test notifications (Teams + email webhook + n8n) without a real ticket event.
 */
const sendTestNotifications = async (targetEmail) => {
  const mockTicket = {
    id: 0,
    subject: "Test notification (safe to ignore)",
    status: "Open",
    priority: "Medium",
    issue_type: "Service",
    name: "Ticket System Test",
    email: targetEmail || process.env.TICKET_TEST_EMAIL || "it@louislawgroup.com",
    engineer: {
      name: "IT Support",
      email: process.env.TICKET_TEST_ASSIGNEE_EMAIL || "",
    },
    group_key: "helpdesk",
  };

  const payload = buildNotificationPayload(mockTicket, "ticket_created", null, {
    isTest: true,
  });
  if (targetEmail) {
    payload.recipientEmails = [targetEmail];
  }

  const results = {};
  try {
    results.n8n = await sendN8nTicketWebhook(payload);
  } catch (e) {
    results.n8n = { error: e.message };
  }
  try {
    results.teams = await sendTeamsMessageCard(payload);
  } catch (e) {
    results.teams = { error: e.message };
  }
  try {
    results.email = await sendEmailViaWebhook(payload);
  } catch (e) {
    results.email = { error: e.message };
  }
  return { payload, results };
};

const notifyTicketEvent = async ({ ticket, eventType, actorUid, extra = {} }) => {
  const payload = buildNotificationPayload(ticket, eventType, actorUid, extra);

  for (const uid of payload.recipientUids) {
    await createInAppNotification({
      userUid: uid,
      ticketId: payload.ticketId,
      eventType,
      title: payload.title,
      body: payload.summaryLine,
    });
  }

  const useN8nOnly =
    process.env.TICKET_NOTIFY_N8N_ONLY === "true" ||
    process.env.TICKET_NOTIFY_N8N_ONLY === "1";

  if (process.env.N8N_TICKET_WEBHOOK_URL || process.env.N8N_TICKET_NOTIFY_URL) {
    try {
      await sendN8nTicketWebhook(payload);
    } catch (err) {
      console.warn("n8n ticket webhook failed:", err.message);
    }
  }

  if (!useN8nOnly) {
    try {
      await sendTeamsMessageCard(payload);
    } catch (err) {
      console.warn("Teams notification failed:", err.message);
    }
    try {
      await sendEmailViaWebhook(payload);
    } catch (err) {
      console.warn("Email webhook failed:", err.message);
    }
  }
};

module.exports = {
  buildNotificationPayload,
  buildTeamsMessageCard,
  createInAppNotification,
  sendTeamsMessageCard,
  sendEmailViaWebhook,
  sendN8nTicketWebhook,
  sendTestNotifications,
  notifyTicketEvent,
  ticketDeepLink,
};
