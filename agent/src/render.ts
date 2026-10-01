// Prompt filling and config reading for the agent (#64), so the page uses the repo's own prompt
// files and config.toml values rather than copies. Free of Worker globals for `node --test`.

/** Fill ${name} placeholders as Python's string.Template.substitute does; a missing name throws. */
export function render(template: string, values: Record<string, unknown>): string {
  return template
    .replace(/\$\{(\w+)\}/g, (_, name: string) => {
      if (!(name in values)) throw new Error(`Prompt uses \${${name}}, which has no value`);
      return String(values[name]);
    })
    .trim();
}

type Value = string | number | boolean | string[];

/** The simple `key = value` lines of one TOML section: strings, numbers, booleans, and one-line
 * arrays of strings. Other lines, such as multi-line arrays, are skipped. */
export function tomlSection(text: string, section: string): Record<string, Value> {
  const values: Record<string, Value> = {};
  let inside = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inside = line === `[${section}]`;
      continue;
    }
    if (!inside || !line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!match) continue;
    const [, key, value] = match;
    if (/^".*"$/.test(value)) values[key] = JSON.parse(value);
    else if (/^-?\d+(\.\d+)?$/.test(value)) values[key] = Number(value);
    else if (value === "true" || value === "false") values[key] = value === "true";
    else if (/^\[.*\]$/.test(value)) values[key] = JSON.parse(value);
  }
  return values;
}
