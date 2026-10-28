// @ts-check

// Creates the GitHub Release (and its `name@version` tag, at the released
// commit) for what the release workflow just published, with the matching
// CHANGELOG.md section as the notes. Changesets' action used to do this when
// it published; publishing now runs in a separate, read-only job in the
// "Release" environment, so this job does it afterwards. A release that
// already exists is left as is.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const publishedPackages = JSON.parse(process.env.PUBLISHED_PACKAGES || "[]");
const commit = process.env.GITHUB_SHA;

/** The `## version` section of the changesets CHANGELOG.md. */
const changelogSection = (version) => {
  let text;
  try {
    text = readFileSync("CHANGELOG.md", "utf8");
  } catch {
    return "";
  }
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return "";
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## ")
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
};

const gh = (args) => execFileSync("gh", args, { stdio: "pipe" }).toString();

let failures = 0;
for (const { name, version } of publishedPackages) {
  const tag = `${name}@${version}`;
  try {
    try {
      gh(["release", "view", tag]);
      console.log(`${tag}: release already exists`);
      continue;
    } catch {
      // not found: create it
    }
    const notes = changelogSection(version) || `Published ${tag} to npm.`;
    const prerelease = version.includes("-") ? ["--prerelease"] : [];
    gh([
      "release",
      "create",
      tag,
      "--title",
      tag,
      "--notes",
      notes,
      "--target",
      String(commit),
      ...prerelease,
    ]);
    console.log(`${tag}: release created`);
  } catch (error) {
    failures++;
    console.log(`::error::Could not create the release for ${tag}: ${error}`);
  }
}

if (failures > 0) process.exit(1);
