import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const TOOLS_JSON_PATH = path.join(ROOT_DIR, 'tools.json');
const TS_OUTPUT_PATH = path.join(ROOT_DIR, 'src', 'tools_data.ts');
const RS_OUTPUT_PATH = path.join(ROOT_DIR, 'src-tauri', 'src', 'tools_data.rs');

function escapeString(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function generateTS(data) {
  const toolsLines = data.tools.map(t => {
    const signature = `- ${t.name}(${t.args_signature}) -> ${t.description}`;
    return `  {
    name: "${t.name}",
    category: "${t.category}",
    description: "${escapeString(t.description)}",
    params: [${t.params.map(p => `"${p}"`).join(', ')}],
    signature: "${escapeString(signature)}"
  }`;
  }).join(',\n');

  const aliasEntries = [];
  data.tools.forEach(t => {
    t.aliases.forEach(alias => {
      aliasEntries.push(`  "${alias}": "${t.name}"`);
    });
  });
  const aliasMapContent = aliasEntries.join(',\n');

  const fewShotsLines = data.few_shot_examples.map(f => {
    return `  {
    categories: [${f.categories.map(c => `"${c}"`).join(', ')}],
    text: "${escapeString(f.text)}"
  }`;
  }).join(',\n');

  const rulesLines = data.rules.map(r => {
    return `  {
    text: "${escapeString(r.text)}",
    categories: [${r.categories.map(c => `"${c}"`).join(', ')}]
  }`;
  }).join(',\n');

  const guildIdToolsLines = data.discord_tools_with_guild_id.map(t => `  "${t}"`).join(',\n');

  const descriptionsContent = data.tools.map(t => `  "${t.name}": "${escapeString(t.description)}"`).join(',\n');
  const paramsContent = data.tools.map(t => `  "${t.name}": [${t.params.map(p => `"${p}"`).join(', ')}]`).join(',\n');

  return `// AUTO-GENERATED from tools.json. DO NOT EDIT DIRECTLY.

export interface ToolDefinition {
  name: string;
  category: string;
  description: string;
  params: string[];
  signature: string;
}

export interface FewShotExample {
  categories: string[];
  text: string;
}

export interface RuleDefinition {
  text: string;
  categories: string[];
}

export const TOOLS = [
${toolsLines}
] as const;

export const ALIAS_MAP = {
${aliasMapContent}
} as const;

export const FEW_SHOTS = [
${fewShotsLines}
] as const;

export const RULES = [
${rulesLines}
] as const;

export const DISCORD_TOOLS_WITH_GUILD_ID = [
${guildIdToolsLines}
] as const;

export const TOOL_DESCRIPTIONS = {
${descriptionsContent}
} as const;

export const TOOL_PARAMS = {
${paramsContent}
} as const;
`;
}

function generateRS(data) {
  const toolsLines = data.tools.map(t => {
    const signature = `- ${t.name}(${t.args_signature}) -> ${t.description}`;
    return `    ToolDefinition {
        name: "${t.name}",
        category: "${t.category}",
        description: "${escapeString(t.description)}",
        params: &[${t.params.map(p => `"${p}"`).join(', ')}],
        signature: "${escapeString(signature)}",
    }`;
  }).join(',\n');

  const aliasEntries = [];
  data.tools.forEach(t => {
    t.aliases.forEach(alias => {
      aliasEntries.push(`    ("${alias}", "${t.name}")`);
    });
  });
  const aliasMapContent = aliasEntries.join(',\n');

  const fewShotsLines = data.few_shot_examples.map(f => {
    return `    FewShotExample {
        categories: &[${f.categories.map(c => `"${c}"`).join(', ')}],
        text: "${escapeString(f.text)}",
    }`;
  }).join(',\n');

  const rulesLines = data.rules.map(r => {
    return `    RuleDefinition {
        text: "${escapeString(r.text)}",
        categories: &[${r.categories.map(c => `"${c}"`).join(', ')}],
    }`;
  }).join(',\n');

  const guildIdToolsLines = data.discord_tools_with_guild_id.map(t => `    "${t}"`).join(',\n');

  return `// AUTO-GENERATED from tools.json. DO NOT EDIT DIRECTLY.

#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub params: &'static [&'static str],
    pub signature: &'static str,
}

#[derive(Debug, Clone)]
pub struct FewShotExample {
    pub categories: &'static [&'static str],
    pub text: &'static str,
}

#[derive(Debug, Clone)]
pub struct RuleDefinition {
    pub text: &'static str,
    pub categories: &'static [&'static str],
}

pub const TOOLS: &[ToolDefinition] = &[
${toolsLines}
];

pub const ALIAS_MAP: &[(&str, &str)] = &[
${aliasMapContent}
];

pub const FEW_SHOTS: &[FewShotExample] = &[
${fewShotsLines}
];

pub const RULES: &[RuleDefinition] = &[
${rulesLines}
];

pub const DISCORD_TOOLS_WITH_GUILD_ID: &[&str] = &[
${guildIdToolsLines}
];
`;
}

function main() {
  console.log(`Reading tools definition from ${TOOLS_JSON_PATH}...`);
  if (!fs.existsSync(TOOLS_JSON_PATH)) {
    console.error(`Error: ${TOOLS_JSON_PATH} not found.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(TOOLS_JSON_PATH, 'utf8');
  const data = JSON.parse(raw);

  console.log('Generating TypeScript data...');
  const tsContent = generateTS(data);
  fs.writeFileSync(TS_OUTPUT_PATH, tsContent, 'utf8');
  console.log(`Saved TS to ${TS_OUTPUT_PATH}`);

  console.log('Generating Rust data...');
  const rsContent = generateRS(data);
  fs.writeFileSync(RS_OUTPUT_PATH, rsContent, 'utf8');
  console.log(`Saved Rust to ${RS_OUTPUT_PATH}`);

  console.log('Synchronization complete!');
}

main();
