import React from "react";

/**
 * Minimal, dependency-free markdown renderer for governance proposal
 * descriptions.
 *
 * Supports the subset authors actually use in proposals: headings, paragraphs,
 * bullet lists, blockquotes, fenced code, bold, italic, inline code, and
 * http(s) links. Everything is rendered as React nodes (never
 * `dangerouslySetInnerHTML`), so untrusted proposal text cannot inject HTML.
 */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <div
      className="space-y-3 text-sm leading-relaxed text-[var(--foreground)]"
      data-testid="markdown-preview"
    >
      {renderBlocks(markdown)}
    </div>
  );
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-[var(--muted)] px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 underline underline-offset-2"
          >
            {link[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function isBlockStart(line: string): boolean {
  return /^(#{1,3}\s|```|[-*]\s|>\s)/.test(line);
}

function renderBlocks(markdown: string): React.ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre
          key={`code-${index}`}
          className="overflow-x-auto rounded-lg bg-[var(--muted)] p-3 font-mono text-xs"
        >
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], `h-${index}`);
      const className =
        level === 1 ? "text-xl font-bold" : level === 2 ? "text-lg font-semibold" : "font-semibold";
      blocks.push(React.createElement(`h${level}`, { key: `h-${index}`, className }, content));
      index += 1;
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `li-${index}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^>\s/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="border-l-2 border-violet-500/60 pl-3 text-[var(--text-muted)]"
        >
          {renderInline(quote.join(" "), `quote-${index}`)}
        </blockquote>
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !isBlockStart(lines[index]) &&
      paragraph.length === 0
    ) {
      paragraph.push(lines[index]);
      index += 1;
      while (index < lines.length && lines[index].trim() !== "" && !isBlockStart(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "), `p-${index}`)}</p>);
  }

  return blocks;
}
