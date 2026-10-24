export interface NotificationTemplate {
  subject: string;
  html: string;
  text?: string;
}

export interface TemplateContext {
  [key: string]: unknown;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const interpolate = (template: string, context: TemplateContext): string =>
  template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = key.split(".").reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object") {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, context);
    return escapeHtml(value);
  });

const wrapHtml = (body: string, unsubscribeUrl?: string): string => {
  const footer = unsubscribeUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#888">Don't want these emails? <a href="${escapeHtml(
        unsubscribeUrl
      )}">Unsubscribe</a>.</p>`
    : "";
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;line-height:1.5">${body}${footer}</body></html>`;
};

const templates: Record<string, NotificationTemplate> = {
  welcome: {
    subject: "Welcome to {{appName}}",
    html: "<h1>Welcome, {{name}}!</h1><p>Thanks for joining {{appName}}.</p>",
    text: "Welcome, {{name}}! Thanks for joining {{appName}}.",
  },
  "password-reset": {
    subject: "Reset your {{appName}} password",
    html: '<h1>Password reset</h1><p>Hi {{name}}, click the link below to reset your password.</p><p><a href="{{resetUrl}}">Reset password</a></p>',
    text: "Hi {{name}}, reset your password: {{resetUrl}}",
  },
  notification: {
    subject: "{{title}}",
    html: "<h1>{{title}}</h1><p>{{message}}</p>",
    text: "{{title}}\n\n{{message}}",
  },
};

export const renderTemplate = (
  name: string,
  context: TemplateContext = {},
  unsubscribeUrl?: string
): NotificationTemplate => {
  const template = templates[name] ?? templates.notification;
  return {
    subject: interpolate(template.subject, context),
    html: wrapHtml(interpolate(template.html, context), unsubscribeUrl),
    text: template.text ? interpolate(template.text, context) : undefined,
  };
};

export const listTemplates = (): string[] => Object.keys(templates);

export const NOTIFICATION_TYPES = [
  "follow",
  "like",
  "comment",
  "mention",
  "tip",
  "governance",
] as const;

export function renderNotificationTemplate(
  type: string,
  context: Record<string, string | undefined> = {}
): { subject: string; text: string; html: string } {
  const username = context["username"] ?? "Someone";
  const amount = context["amount"] ?? "an amount";
  const postTitle = context["postTitle"] ?? "a post";
  const proposalTitle = context["proposalTitle"] ?? "a proposal";

  let subject = "";
  let text = "";

  switch (type) {
    case "follow":
      subject = `${username} started following you`;
      text = `${username} started following you`;
      break;
    case "like":
      subject = `${username} liked your post`;
      text = `${username} liked your post ${postTitle}`;
      break;
    case "comment":
      subject = `${username} commented on your post`;
      text = `${username} commented on ${postTitle}`;
      break;
    case "mention":
      subject = `${username} mentioned you`;
      text = `${username} mentioned you in ${postTitle}`;
      break;
    case "tip":
      subject = `${username} sent you a tip`;
      text = `${username} sent you ${amount}`;
      break;
    case "governance":
      subject = `Governance update: ${proposalTitle}`;
      text = `There is an update on ${proposalTitle}`;
      break;
    default:
      subject = `Notification from Linkora`;
      text = `You have a new notification`;
      break;
  }

  const escapedText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `<p>${escapedText}</p>`;

  return { subject, text, html };
}
