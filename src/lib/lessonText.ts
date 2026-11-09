// The lesson text often opens with its own "UNIT 2: TITLE" heading and a
// rule. The book-style reader already shows that as the chapter header, so
// drop the duplicate from the body.
export function stripLeadingHeading(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && lines[i].trim() === "") i++;
  };
  skipBlank();
  let removed = 0;
  while (i < lines.length && removed < 2) {
    const line = lines[i].trim();
    const isUnitHeading = /^#{1,6}\s*(\*\*)?\s*(unit|module)\s+[a-z0-9]+\b/i.test(line);
    const isRule = /^(-{3,}|\*{3,}|_{3,})$/.test(line);
    if (!isUnitHeading && !isRule) break;
    i++;
    removed++;
    skipBlank();
  }
  return lines.slice(i).join("\n");
}
