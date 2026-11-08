"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Lessons are written by the AI in LaTeX-style math. This cleans up the few
// shapes it gets wrong, so KaTeX can draw real fractions, powers, subscripts
// and sums exactly like a printed textbook.
function normalizeMath(src: string): string {
  let out = src;

  // \( ... \) -> $...$   and   \[ ... \] -> $$...$$
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`);
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n\n$$\n${m.trim()}\n$$\n\n`);

  // Multi-line environments lose their row breaks ("\\" becomes "\ ").
  // Inside aligned/align/cases/matrix blocks, turn a lone "\ " back into "\\ ".
  out = out.replace(
    /\\begin\{(aligned|align\*?|cases|array|[pbvBV]?matrix)\}([\s\S]*?)\\end\{\1\}/g,
    (_, env: string, body: string) =>
      `\\begin{${env}}${body.replace(/(^|[^\\])\\(?=\s)/g, "$1\\\\")}\\end{${env}}`
  );

  return out;
}

function LessonMarkdown({ children }: { children: string }) {
  const text = useMemo(() => normalizeMath(children), [children]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
    >
      {text}
    </ReactMarkdown>
  );
}

export default memo(LessonMarkdown);
