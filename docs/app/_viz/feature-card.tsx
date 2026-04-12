"use client";

import { useState, type ReactNode } from "react";

interface FeatureCardProps {
  title: string;
  description: ReactNode;
  viz: ReactNode;
  code: string;
  language?: string;
}

export function FeatureCard({
  title,
  description,
  viz,
  code,
  language = "ts",
}: FeatureCardProps) {
  const [showCode, setShowCode] = useState(false);
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-outline-variant/10 bg-surface-container-low/40 p-5 backdrop-blur-xl sm:p-7">
      <div className="flex flex-col gap-1.5">
        <h3 className="font-display text-xl font-semibold text-on-surface">
          {title}
        </h3>
        <p className="max-w-2xl text-sm leading-relaxed text-on-surface-variant/80">
          {description}
        </p>
      </div>
      {viz}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setShowCode((v) => !v)}
          className="self-start text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/50 transition-colors hover:text-primary"
        >
          {showCode ? "– hide code" : "+ show code"}
        </button>
        {showCode && (
          <pre className="max-w-full overflow-x-auto rounded-lg border border-outline-variant/10 bg-black/40 p-4 text-[12px] leading-relaxed text-on-surface-variant/80">
            <code className={`language-${language}`}>{code}</code>
          </pre>
        )}
      </div>
    </section>
  );
}
