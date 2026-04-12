"use client";

import { useMemo } from "react";

interface CodeBlockProps {
  code: string;
  highlights?: number[];
}

type Token = { type: string; text: string };

const KEYWORDS = new Set([
  "import", "from", "export", "const", "let", "var", "function", "return",
  "if", "else", "for", "of", "in", "as", "new", "typeof", "type",
]);

function tokenizeLine(raw: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "\u00ab") {
      const end = raw.indexOf("\u00bb", i + 1);
      if (end !== -1) {
        tokens.push({ type: "dynamic", text: raw.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (raw[i] === "/" && raw[i + 1] === "/") {
      tokens.push({ type: "comment", text: raw.slice(i) });
      i = raw.length;
      continue;
    }

    if (raw[i] === '"' || raw[i] === "'" || raw[i] === "`") {
      const q = raw[i];
      let j = i + 1;
      while (j < raw.length && raw[j] !== q) {
        if (raw[j] === "\\") j++;
        j++;
      }
      tokens.push({ type: "string", text: raw.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(raw[i]) && (i === 0 || /[\s,([{:=*+\-/]/.test(raw[i - 1]))) {
      let j = i;
      while (j < raw.length && /[0-9._xXa-fA-F]/.test(raw[j])) j++;
      tokens.push({ type: "number", text: raw.slice(i, j) });
      i = j;
      continue;
    }

    if (/[a-zA-Z_$]/.test(raw[i])) {
      let j = i;
      while (j < raw.length && /[a-zA-Z0-9_$]/.test(raw[j])) j++;
      const word = raw.slice(i, j);
      tokens.push({
        type: KEYWORDS.has(word) ? "keyword" : "ident",
        text: word,
      });
      i = j;
      continue;
    }

    tokens.push({ type: "plain", text: raw[i] });
    i++;
  }
  return tokens;
}

const COLORS: Record<string, string> = {
  keyword: "text-secondary",
  string: "text-primary/80",
  number: "text-tertiary",
  comment: "text-on-surface-variant/40 italic",
  dynamic: "dynamic-value",
  ident: "",
  plain: "",
};

export function CodeBlock({ code, highlights }: CodeBlockProps) {
  const lines = useMemo(() => {
    const trimmed = code.trim();
    const highlightSet = new Set(highlights);
    return trimmed.split("\n").map((line, idx) => {
      const lineNum = idx + 1;
      const hasDynamic = line.includes("\u00ab");
      const tokens = tokenizeLine(line);
      const isHighlighted = highlightSet.has(lineNum) || hasDynamic;
      return { tokens, isHighlighted };
    });
  }, [code, highlights]);

  return (
    <pre className="max-w-full overflow-x-auto rounded-xl bg-surface-variant/60 p-5 text-[12px] leading-relaxed text-on-surface-variant/70 backdrop-blur-xl">
      <code>
        {lines.map((line, i) => (
          <span
            key={i}
            className={
              line.isHighlighted
                ? "highlighted-line -mx-4 block px-4"
                : "block"
            }
          >
            {line.tokens.map((tok, j) => {
              const cls = COLORS[tok.type];
              return cls ? (
                <span key={j} className={cls}>
                  {tok.text}
                </span>
              ) : (
                tok.text
              );
            })}
            {line.tokens.length === 0 && "\n"}
          </span>
        ))}
      </code>
    </pre>
  );
}
