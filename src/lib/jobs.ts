export interface JobLine {
  id: string;
  code: string;
  concern: string;
  cause: string;
  correction: string;
}

export function lineLetter(index: number) {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function nextLineCode(jobs: { code: string }[]) {
  const used = new Set(jobs.map((job) => job.code));
  for (let i = 0; i < 200; i += 1) {
    const code = lineLetter(i);
    if (!used.has(code)) return code;
  }
  return "A";
}

export function concernFromJobs(jobs: { concern: string }[]) {
  return jobs.map((job) => job.concern.trim()).filter(Boolean).join(" · ");
}

export function concernFromLines(lines: { code?: string; concern: string }[]) {
  return lines
    .filter((line) => line.concern.trim())
    .map((line) => (line.code ? `${line.code}. ${line.concern.trim()}` : line.concern.trim()))
    .join(" · ");
}

export function jobLine(id: string, code: string, concern = "", cause = "", correction = ""): JobLine {
  return { id, code, concern, cause, correction };
}
