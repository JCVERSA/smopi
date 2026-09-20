import path from 'path';
import fs from 'fs';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';

export interface ActionRecord {
  type: 'created' | 'modified' | 'renamed' | 'deleted' | 'duplicated' | 'indexed' | 'analyzed';
  file: string;
  details?: string;
  timestamp: string;
}

export interface SmopiResponse {
  text: string;
  actionsTaken: ActionRecord[];
  hasApiKey: boolean;
  model: string;
}

// Lazy Gemini SDK client accessor
let genAIClient: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }
  if (!genAIClient) {
    genAIClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return genAIClient;
}

// Ensure target filename is clean, safe, and avoids path traversal
export function sanitizeFileName(name: string): string {
  let clean = path.basename(name).trim();
  if (clean.startsWith('.')) {
    clean = clean.replace(/^\.+/, '') || 'file.txt';
  }
  clean = clean.replace(/[\x00-\x1f\x7f]/g, '');
  clean = clean.replace(/[\/\\:*?"<>|]/g, '_');
  return clean || `file_${Date.now()}.txt`;
}

// Resolve child file safely inside root directory
export function resolveSafePath(rootDir: string, name: string): string | null {
  const sanitized = sanitizeFileName(name);
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(path.join(rootDir, sanitized));
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return resolvedTarget;
}

// Tool definitions for Gemini function calling
const listFilesTool: FunctionDeclaration = {
  name: 'list_files',
  description: 'List all current files in the shared workspace, including name, size, type, and preview excerpt.',
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

const readFileTool: FunctionDeclaration = {
  name: 'read_file',
  description: 'Read the text content of a file in the workspace (markdown, text, code, json, etc.).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      fileName: {
        type: Type.STRING,
        description: 'The exact name of the file to read.'
      }
    },
    required: ['fileName']
  }
};

const createFileTool: FunctionDeclaration = {
  name: 'create_file',
  description: 'Create a new file in the workspace with given filename and text content (e.g. notes, documentation, index, code).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      fileName: {
        type: Type.STRING,
        description: 'The name of the new file to create (e.g. notes.md, data.json, script.js).'
      },
      content: {
        type: Type.STRING,
        description: 'The full text or markdown content of the new file.'
      }
    },
    required: ['fileName', 'content']
  }
};

const modifyFileTool: FunctionDeclaration = {
  name: 'modify_file',
  description: 'Modify or edit an existing file in the workspace by either overwriting it or appending content.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      fileName: {
        type: Type.STRING,
        description: 'The name of the existing file to modify.'
      },
      content: {
        type: Type.STRING,
        description: 'The content to write or append.'
      },
      mode: {
        type: Type.STRING,
        description: "Either 'overwrite' to replace content completely, or 'append' to add to the end.",
      }
    },
    required: ['fileName', 'content']
  }
};

const renameFileTool: FunctionDeclaration = {
  name: 'rename_file',
  description: 'Rename an existing file in the workspace.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      oldName: {
        type: Type.STRING,
        description: 'The current filename.'
      },
      newName: {
        type: Type.STRING,
        description: 'The desired new filename.'
      }
    },
    required: ['oldName', 'newName']
  }
};

const deleteFileTool: FunctionDeclaration = {
  name: 'delete_file',
  description: 'Delete one or more files from the shared workspace.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      fileNames: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'List of filenames to delete.'
      }
    },
    required: ['fileNames']
  }
};

const duplicateFileTool: FunctionDeclaration = {
  name: 'duplicate_file',
  description: 'Create a copy or backup of an existing file in the workspace.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      sourceName: {
        type: Type.STRING,
        description: 'The name of the file to duplicate.'
      },
      copyName: {
        type: Type.STRING,
        description: 'Optional name for the copy. If omitted, a _copy suffix is added.'
      }
    },
    required: ['sourceName']
  }
};

const organizeWorkspaceTool: FunctionDeclaration = {
  name: 'organize_workspace',
  description: 'Perform batch organization operations on the workspace: generate a structured INDEX.md directory table, standardize naming conventions, or summarize content.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      operation: {
        type: Type.STRING,
        description: "'generate_index' to create INDEX.md, 'standardize_names' to clean filenames to kebab-case/snake_case, or 'create_overview' for a comprehensive summary."
      }
    },
    required: ['operation']
  }
};

const smopiTools = [
  listFilesTool,
  readFileTool,
  createFileTool,
  modifyFileTool,
  renameFileTool,
  deleteFileTool,
  duplicateFileTool,
  organizeWorkspaceTool
];

// Execute a tool locally on SHARE_DIR
export function executeSmopiTool(
  name: string,
  args: any,
  shareDir: string,
  actionsTaken: ActionRecord[]
): { result?: any; error?: string } {
  try {
    switch (name) {
      case 'list_files': {
        const files: any[] = [];
        if (fs.existsSync(shareDir)) {
          const entries = fs.readdirSync(shareDir);
          for (const entry of entries) {
            if (entry.startsWith('.')) continue;
            const fullPath = path.join(shareDir, entry);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) {
                let preview = '';
                // Read small snippet if it's text/markdown/json
                const ext = path.extname(entry).toLowerCase();
                if (['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.csv'].includes(ext) && stat.size < 50000) {
                  const content = fs.readFileSync(fullPath, 'utf8');
                  preview = content.slice(0, 300);
                }
                files.push({
                  name: entry,
                  size: stat.size,
                  mtime: stat.mtime.toISOString(),
                  preview
                });
              }
            } catch (_) {}
          }
        }
        return { result: { count: files.length, files } };
      }

      case 'read_file': {
        const fileName = sanitizeFileName(args.fileName || '');
        const fullPath = resolveSafePath(shareDir, fileName);
        if (!fullPath || !fs.existsSync(fullPath)) {
          return { error: `File "${fileName}" not found in workspace.` };
        }
        const stat = fs.statSync(fullPath);
        if (stat.size > 200 * 1024) {
          const content = fs.readFileSync(fullPath, 'utf8').slice(0, 200 * 1024);
          return { result: { fileName, content, truncated: true, totalSize: stat.size } };
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        return { result: { fileName, content, size: stat.size } };
      }

      case 'create_file': {
        const fileName = sanitizeFileName(args.fileName || 'document.txt');
        const content = args.content ?? '';
        const fullPath = resolveSafePath(shareDir, fileName);
        if (!fullPath) {
          return { error: `Invalid filename: "${args.fileName}"` };
        }
        fs.writeFileSync(fullPath, content, 'utf8');
        actionsTaken.push({
          type: 'created',
          file: fileName,
          details: `Created file (${content.length} characters)`,
          timestamp: new Date().toLocaleTimeString()
        });
        return { result: { success: true, fileName, size: content.length } };
      }

      case 'modify_file': {
        const fileName = sanitizeFileName(args.fileName || '');
        const mode = args.mode === 'append' ? 'append' : 'overwrite';
        const content = args.content ?? '';
        const fullPath = resolveSafePath(shareDir, fileName);
        if (!fullPath || !fs.existsSync(fullPath)) {
          return { error: `File "${fileName}" does not exist to modify.` };
        }
        if (mode === 'append') {
          fs.appendFileSync(fullPath, '\n' + content, 'utf8');
        } else {
          fs.writeFileSync(fullPath, content, 'utf8');
        }
        actionsTaken.push({
          type: 'modified',
          file: fileName,
          details: mode === 'append' ? 'Appended new content' : 'Overwrote file content',
          timestamp: new Date().toLocaleTimeString()
        });
        return { result: { success: true, fileName, mode } };
      }

      case 'rename_file': {
        const oldName = sanitizeFileName(args.oldName || '');
        const newName = sanitizeFileName(args.newName || '');
        const oldPath = resolveSafePath(shareDir, oldName);
        const newPath = resolveSafePath(shareDir, newName);
        if (!oldPath || !fs.existsSync(oldPath)) {
          return { error: `Source file "${oldName}" does not exist.` };
        }
        if (!newPath) {
          return { error: `Invalid target filename "${newName}".` };
        }
        if (fs.existsSync(newPath) && oldPath !== newPath) {
          return { error: `Target file "${newName}" already exists.` };
        }
        fs.renameSync(oldPath, newPath);
        actionsTaken.push({
          type: 'renamed',
          file: `${oldName} → ${newName}`,
          details: `Renamed from ${oldName}`,
          timestamp: new Date().toLocaleTimeString()
        });
        return { result: { success: true, oldName, newName } };
      }

      case 'delete_file': {
        const fileNames: string[] = Array.isArray(args.fileNames) ? args.fileNames : [args.fileName].filter(Boolean);
        const deleted: string[] = [];
        const failed: string[] = [];

        for (const name of fileNames) {
          const sanitized = sanitizeFileName(name);
          const fullPath = resolveSafePath(shareDir, sanitized);
          if (fullPath && fs.existsSync(fullPath)) {
            try {
              fs.unlinkSync(fullPath);
              deleted.push(sanitized);
              actionsTaken.push({
                type: 'deleted',
                file: sanitized,
                details: 'Deleted from workspace',
                timestamp: new Date().toLocaleTimeString()
              });
            } catch (_) {
              failed.push(sanitized);
            }
          } else {
            failed.push(sanitized);
          }
        }
        return { result: { deleted, failed, success: deleted.length > 0 } };
      }

      case 'duplicate_file': {
        const sourceName = sanitizeFileName(args.sourceName || '');
        const sourcePath = resolveSafePath(shareDir, sourceName);
        if (!sourcePath || !fs.existsSync(sourcePath)) {
          return { error: `Source file "${sourceName}" does not exist.` };
        }
        const ext = path.extname(sourceName);
        const base = path.basename(sourceName, ext);
        const defaultCopy = `${base}_copy${ext}`;
        const copyName = sanitizeFileName(args.copyName || defaultCopy);
        const copyPath = resolveSafePath(shareDir, copyName);
        if (!copyPath) {
          return { error: `Invalid copy name: ${copyName}` };
        }
        fs.copyFileSync(sourcePath, copyPath);
        actionsTaken.push({
          type: 'duplicated',
          file: copyName,
          details: `Copied from ${sourceName}`,
          timestamp: new Date().toLocaleTimeString()
        });
        return { result: { success: true, sourceName, copyName } };
      }

      case 'organize_workspace': {
        const op = args.operation || 'generate_index';
        if (op === 'generate_index') {
          const entries = fs.readdirSync(shareDir).filter(e => !e.startsWith('.'));
          let indexMd = `# Workspace Directory Index\n\nGenerated by **Smopi AI** on ${new Date().toLocaleString()}\n\n`;
          indexMd += `Total Files: **${entries.length}**\n\n`;
          indexMd += `| File Name | Size | Type | Status |\n`;
          indexMd += `| :--- | :--- | :--- | :--- |\n`;

          for (const entry of entries) {
            const fp = path.join(shareDir, entry);
            try {
              const stat = fs.statSync(fp);
              const ext = path.extname(entry).slice(1).toUpperCase() || 'FILE';
              const kb = (stat.size / 1024).toFixed(1) + ' KB';
              indexMd += `| \`${entry}\` | ${kb} | ${ext} | Active |\n`;
            } catch (_) {}
          }
          indexMd += `\n---\n*Created automatically to help manage and navigate workspace documents.*\n`;
          const targetPath = path.join(shareDir, 'WORKSPACE_INDEX.md');
          fs.writeFileSync(targetPath, indexMd, 'utf8');
          actionsTaken.push({
            type: 'indexed',
            file: 'WORKSPACE_INDEX.md',
            details: `Created workspace index listing ${entries.length} files`,
            timestamp: new Date().toLocaleTimeString()
          });
          return { result: { success: true, file: 'WORKSPACE_INDEX.md', entriesCount: entries.length } };
        }

        if (op === 'standardize_names') {
          const entries = fs.readdirSync(shareDir).filter(e => !e.startsWith('.'));
          const renamed: { oldName: string; newName: string }[] = [];
          for (const entry of entries) {
            // Clean up patterns like "file (1).txt" or whitespace
            let cleaned = entry.replace(/\s*\(\d+\)/g, '').replace(/\s+/g, '_');
            cleaned = cleaned.replace(/_+/g, '_');
            if (cleaned !== entry) {
              const oldP = path.join(shareDir, entry);
              const newP = path.join(shareDir, cleaned);
              if (!fs.existsSync(newP)) {
                fs.renameSync(oldP, newP);
                renamed.push({ oldName: entry, newName: cleaned });
                actionsTaken.push({
                  type: 'renamed',
                  file: `${entry} → ${cleaned}`,
                  details: 'Standardized filename format',
                  timestamp: new Date().toLocaleTimeString()
                });
              }
            }
          }
          return { result: { success: true, renamedCount: renamed.length, renamed } };
        }

        return { result: { message: `Operation ${op} completed.` } };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err: any) {
    return { error: err.message || 'Execution error' };
  }
}

// Fallback command engine when GEMINI_API_KEY is not configured
export function processLocalCommand(
  userMessage: string,
  shareDir: string
): SmopiResponse {
  const actionsTaken: ActionRecord[] = [];
  const text = userMessage.trim();
  const lower = text.toLowerCase();

  // 1. Help or info request
  if (lower === 'help' || lower.includes('what can you do')) {
    return {
      text: `👋 **Hi! I'm Smopi**, your AI file assistant!\n\n` +
        `I can manage, create, organize, modify, and delete files in your workspace.\n\n` +
        `**Quick commands you can run right now:**\n` +
        `• \`create <filename> with <content>\` (e.g. *create meeting_notes.md with # Team Notes*)\n` +
        `• \`read <filename>\` (e.g. *read Welcome.txt*)\n` +
        `• \`delete <filename>\` (e.g. *delete old_notes.txt*)\n` +
        `• \`rename <old> to <new>\` (e.g. *rename test.txt to final.txt*)\n` +
        `• \`index\` or \`organize\` (Generates a structured WORKSPACE_INDEX.md)\n` +
        `• \`summarize\` (Generates a consolidated summary of all files)\n` +
        `• \`list files\`\n\n` +
        `💡 *Tip: Set the \`GEMINI_API_KEY\` environment variable to enable full multi-turn conversational intelligence, auto-categorization, and deep file analysis!*`,
      actionsTaken,
      hasApiKey: false,
      model: 'local-smopi-engine'
    };
  }

  // 2. Index or organize
  if (lower.startsWith('index') || lower.startsWith('organize') || lower.includes('generate index') || lower.includes('catalog')) {
    executeSmopiTool('organize_workspace', { operation: 'generate_index' }, shareDir, actionsTaken);
    return {
      text: `✨ I've organized your workspace and generated a fresh **\`WORKSPACE_INDEX.md\`** table cataloging all current files! You can preview or download it right now from the files list.`,
      actionsTaken,
      hasApiKey: false,
      model: 'local-smopi-engine'
    };
  }

  // 3. Summarize files
  if (lower.includes('summarize') || lower.includes('overview') || lower.includes('summary')) {
    const entries = fs.readdirSync(shareDir).filter(e => !e.startsWith('.'));
    let summaryContent = `# Workspace Files Summary\n\nGenerated by **Smopi** on ${new Date().toLocaleString()}\n\n`;
    summaryContent += `Total files in share workspace: **${entries.length}**\n\n## Overview\n\n`;

    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      const fp = path.join(shareDir, entry);
      try {
        const stat = fs.statSync(fp);
        summaryContent += `### 📄 \`${entry}\` (${(stat.size / 1024).toFixed(1)} KB)\n`;
        if (['.txt', '.md', '.json', '.csv'].includes(ext) && stat.size < 40000) {
          const body = fs.readFileSync(fp, 'utf8');
          const lines = body.split('\n').filter(l => l.trim()).slice(0, 5);
          summaryContent += `> ${lines.join('\n> ')}\n\n`;
        } else {
          summaryContent += `Binary or media file format.\n\n`;
        }
      } catch (_) {}
    }

    const targetPath = path.join(shareDir, 'WORKSPACE_SUMMARY.md');
    fs.writeFileSync(targetPath, summaryContent, 'utf8');
    actionsTaken.push({
      type: 'created',
      file: 'WORKSPACE_SUMMARY.md',
      details: 'Generated consolidated summary of workspace files',
      timestamp: new Date().toLocaleTimeString()
    });

    return {
      text: `📊 I generated a comprehensive summary document: **\`WORKSPACE_SUMMARY.md\`** containing details and excerpts for all ${entries.length} files in the workspace!`,
      actionsTaken,
      hasApiKey: false,
      model: 'local-smopi-engine'
    };
  }

  // 4. Create file: "create <filename> with <content>" or "create file <filename>..."
  const createMatch = text.match(/create(?:\s+file)?\s+([^\s:]+)(?:\s*(?:with|:|\n)\s*([\s\S]+))?/i);
  if (createMatch) {
    const fileName = createMatch[1];
    const content = createMatch[2] || `# ${fileName}\n\nCreated by Smopi on ${new Date().toLocaleString()}`;
    const res = executeSmopiTool('create_file', { fileName, content }, shareDir, actionsTaken);
    if (res.error) {
      return { text: `⚠️ Could not create file: ${res.error}`, actionsTaken, hasApiKey: false, model: 'local-smopi-engine' };
    }
    return {
      text: `✅ Successfully created **\`${fileName}\`** in your workspace!`,
      actionsTaken,
      hasApiKey: false,
      model: 'local-smopi-engine'
    };
  }

  // 5. Delete file: "delete <filename>" or "remove <filename>"
  const deleteMatch = text.match(/(?:delete|remove)(?:\s+file)?\s+([^\s,]+)/i);
  if (deleteMatch) {
    const fileName = deleteMatch[1];
    const res = executeSmopiTool('delete_file', { fileNames: [fileName] }, shareDir, actionsTaken);
    if (res.error || !res.result?.success) {
      return { text: `⚠️ Could not delete "${fileName}". Please check if the filename exists.`, actionsTaken, hasApiKey: false, model: 'local-smopi-engine' };
    }
    return {
      text: `🗑️ Deleted **\`${fileName}\`** from the workspace.`,
      actionsTaken,
      hasApiKey: false,
      model: 'local-smopi-engine'
    };
  }

  // 6. Rename file: "rename <old> to <new>"
  const renameMatch = text.match(/rename\s+([^\s]+)\s+to\s+([^\s]+)/i);
  if (renameMatch) {
    const oldName = renameMatch[1];
    const newName = renameMatch[2];
    const res = executeSmopiTool('rename_file', { oldName, newName }, shareDir, actionsTaken);
    if (res.error) {
      return { text: `⚠️ Could not rename: ${res.error}`, actionsTaken, hasApiKey: false, model: 'local-smopi-engine' };
    }
    return {
      text: `✏️ Renamed **\`${oldName}\`** to **\`${newName}\`**!`,
      actionsTaken,
      hasApiKey: false,
      model: 'local-smopi-engine'
    };
  }

  // 7. Read file: "read <filename>" or "show <filename>"
  const readMatch = text.match(/(?:read|show|view|open)(?:\s+file)?\s+([^\s]+)/i);
  if (readMatch) {
    const fileName = readMatch[1];
    const res = executeSmopiTool('read_file', { fileName }, shareDir, actionsTaken);
    if (res.error) {
      return { text: `⚠️ ${res.error}`, actionsTaken, hasApiKey: false, model: 'local-smopi-engine' };
    }
    return {
      text: `📖 **Contents of \`${fileName}\`:**\n\`\`\`\n${res.result.content.slice(0, 1500)}\n\`\`\`${res.result.content.length > 1500 ? '\n*(Content truncated for preview)*' : ''}`,
      actionsTaken,
      hasApiKey: false,
      model: 'local-smopi-engine'
    };
  }

  // 8. List files
  if (lower.includes('list') || lower.includes('files') || lower.includes('status')) {
    const res = executeSmopiTool('list_files', {}, shareDir, actionsTaken);
    const files = res.result?.files || [];
    if (files.length === 0) {
      return { text: `📂 Your workspace is currently empty. Drop files to upload or ask me to create some!`, actionsTaken, hasApiKey: false, model: 'local-smopi-engine' };
    }
    const fileListStr = files.map((f: any) => `• **\`${f.name}\`** (${(f.size / 1024).toFixed(1)} KB)`).join('\n');
    return {
      text: `📂 **Workspace has ${files.length} file${files.length > 1 ? 's' : ''}:**\n\n${fileListStr}\n\nWhat would you like me to do with them?`,
      actionsTaken,
      hasApiKey: false,
      model: 'local-smopi-engine'
    };
  }

  // Default fallback response
  return {
    text: `I received: "${userMessage}".\n\n` +
      `I can perform actions like:\n` +
      `• **Create**: "create meeting_notes.md with notes..."\n` +
      `• **Delete**: "delete old_file.txt"\n` +
      `• **Rename**: "rename file.txt to document.txt"\n` +
      `• **Organize**: "generate index" or "summarize all files"\n\n` +
      `💡 *To ask open-ended questions and unlock full natural reasoning, configure your \`GEMINI_API_KEY\` in environment settings!*`,
    actionsTaken,
    hasApiKey: false,
    model: 'local-smopi-engine'
  };
}

// Models to attempt in priority order (with automatic failover on 503 high-demand or rate limits)
const CANDIDATE_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest'];

function isTransientError(err: any): boolean {
  if (!err) return false;
  const status = err.status || err.code || (err.error && err.error.code);
  const msg = (err.message || '').toLowerCase();
  return (
    status === 503 ||
    status === 429 ||
    status === 500 ||
    status === 504 ||
    msg.includes('high demand') ||
    msg.includes('unavailable') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('try again later') ||
    msg.includes('overloaded')
  );
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: {
    contents: any[];
    systemInstruction: string;
    tools: any[];
    temperature?: number;
  }
): Promise<{ response: any; modelUsed: string }> {
  let lastError: any = null;

  for (const model of CANDIDATE_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: {
            systemInstruction: params.systemInstruction,
            temperature: params.temperature ?? 0.4,
            tools: params.tools,
          },
        });
        return { response, modelUsed: model };
      } catch (err: any) {
        lastError = err;
        if (isTransientError(err) && attempt < 1) {
          const delayMs = 500 + Math.floor(Math.random() * 400);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        // Move to fallback candidate model if available
        break;
      }
    }
  }

  throw lastError;
}

// Full Gemini Agent execution loop with multi-step Function Calling
export async function runSmopiAgent(
  userMessage: string,
  shareDir: string,
  history: { role: 'user' | 'model'; text: string }[] = []
): Promise<SmopiResponse> {
  const ai = getGenAI();

  // If no API key configured, use local fallback command engine
  if (!ai) {
    return processLocalCommand(userMessage, shareDir);
  }

  const actionsTaken: ActionRecord[] = [];
  const systemInstruction = `You are "Smopi", an intelligent, highly skilled AI file management assistant embedded in a secure, temporary file sharing workspace.

Your capabilities include:
1. Managing files: listing, reading, creating, modifying, renaming, organizing, and deleting files.
2. Generating documentation, reports, summaries (like INDEX.md, WORKSPACE_SUMMARY.md, or project READMEs).
3. Analyzing and transforming content (e.g. formatting Markdown, converting JSON to CSV/tables, proofreading notes).
4. Organizing messy file lists (standardizing naming conventions, detecting duplicates).

Rules:
- Be concise, friendly, helpful, and proactive.
- When the user asks you to create, modify, or organize files, execute the appropriate tool(s) directly.
- Always provide clear summaries of changes made and highlight affected filenames in backticks (e.g. \`notes.md\`).
- If a file doesn't exist, tell the user politely and offer to list existing files or create it.
- Keep output nicely formatted using Markdown headings, bold text, and bullet points.`;

  try {
    // Construct initial contents with chat history
    const contents: any[] = [];
    
    // Add past 4 messages for conversational context
    const recentHistory = history.slice(-4);
    for (const h of recentHistory) {
      contents.push({
        role: h.role,
        parts: [{ text: h.text }]
      });
    }

    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    let { response: currentResponse, modelUsed } = await generateContentWithRetry(ai, {
      contents,
      systemInstruction,
      tools: [{ functionDeclarations: smopiTools }],
      temperature: 0.4,
    });

    // Handle tool calls loop (up to 4 steps)
    let iterations = 0;
    while (currentResponse.functionCalls && currentResponse.functionCalls.length > 0 && iterations < 4) {
      iterations++;
      const functionCalls = currentResponse.functionCalls;
      const modelContent = currentResponse.candidates?.[0]?.content;
      if (modelContent) {
        contents.push(modelContent);
      }

      const toolResponseParts: any[] = [];
      for (const call of functionCalls) {
        const callName = call.name || '';
        const { result, error } = executeSmopiTool(callName, call.args || {}, shareDir, actionsTaken);
        toolResponseParts.push({
          functionResponse: {
            name: callName,
            response: error ? { error } : (result || { success: true })
          }
        });
      }

      contents.push({
        role: 'user',
        parts: toolResponseParts
      });

      const next = await generateContentWithRetry(ai, {
        contents,
        systemInstruction,
        tools: [{ functionDeclarations: smopiTools }],
        temperature: 0.4,
      });
      currentResponse = next.response;
      modelUsed = next.modelUsed;
    }

    const finalText = currentResponse.text || 'I completed the requested file actions in your workspace.';
    return {
      text: finalText,
      actionsTaken,
      hasApiKey: true,
      model: modelUsed,
    };
  } catch (err: any) {
    const isDemandSpike = isTransientError(err);
    console.warn(
      `Smopi: Gemini API ${isDemandSpike ? 'high demand / transient unavailable' : 'error'} (${err.status || err.code || 'transient'}). Gracefully serving via local workspace engine.`
    );
    // Graceful fallback to local command engine if API rate-limit / demand spike occurs
    const fallback = processLocalCommand(userMessage, shareDir);
    const notice = isDemandSpike
      ? 'Gemini AI is currently experiencing high demand. Smopi seamlessly handled your request using the built-in local workspace engine.'
      : 'Gemini service is temporarily unreachable. Smopi processed your request using the built-in local workspace engine.';
    fallback.text = `*(Notice: ${notice})*\n\n` + fallback.text;
    return fallback;
  }
}
