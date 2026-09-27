/** Browser capabilities and persistence enter the qualification UI through this module. */
export { loadQualificationDraft, saveQualificationDraft } from "./qualification-storage.js";

export function qualificationClient(): {
  operatingSystem: string;
  browser: string;
  browserVersion: string;
  secureContext: boolean;
} {
  const userAgent = navigator.userAgent;
  const candidates: [string, RegExp][] = [
    ["Edge", /Edg\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  const detected = candidates
    .map(([browser, pattern]) => ({ browser, version: pattern.exec(userAgent)?.[1] }))
    .find((result) => result.version);
  const systems: [string, RegExp][] = [
    ["Android", /Android ([\d.]+)/],
    ["iOS", /(?:iPhone OS|CPU OS) ([\d_]+)/],
    ["macOS", /Mac OS X ([\d_]+)/],
    ["Windows NT", /Windows NT ([\d.]+)/],
  ];
  let operatingSystem = userAgent.includes("Linux") ? "Linux" : "Unknown";
  for (const [name, pattern] of systems) {
    const match = pattern.exec(userAgent);
    if (match?.[1]) {
      operatingSystem = `${name} ${match[1].replaceAll("_", ".")}`;
      break;
    }
  }
  return {
    operatingSystem,
    browser: detected?.browser ?? "Unknown",
    browserVersion: detected?.version ?? "Unknown",
    secureContext: window.isSecureContext,
  };
}

export function downloadText(content: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
