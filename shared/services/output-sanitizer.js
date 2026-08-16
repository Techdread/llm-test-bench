/**
 * Shared output sanitization helpers for AI-generated content.
 *
 * These helpers are intentionally conservative:
 * - strip think/reasoning wrappers
 * - unwrap markdown code fences
 * - extract likely content for common artifact types
 */

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripThinkTokens(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think>\s*/gi, '').trim();
}

export function stripCodeFences(text, { languages = [] } = {}) {
  if (typeof text !== 'string') return '';

  let output = text.trim();
  const normalized = languages
    .filter(Boolean)
    .map(language => escapeRegex(String(language).trim()))
    .filter(Boolean);

  const languagePattern = normalized.length > 0
    ? `(?:${normalized.join('|')})`
    : '[a-z0-9_+-]+';

  const openingFence = new RegExp(`^\\s*\\\`\\\`\\\`(?:${languagePattern})?\\s*\\n?`, 'i');
  output = output.replace(openingFence, '');
  output = output.replace(/\n?\s*```\s*$/i, '');

  const fencedBlock = new RegExp(`^\\s*\\\`\\\`\\\`(?:${languagePattern})?\\s*\\n?([\\s\\S]*?)\\n?\\\`\\\`\\\`\\s*$`, 'i');
  const match = output.match(fencedBlock);
  if (match) {
    output = match[1];
  }

  return output.trim();
}

export function extractJsonText(text) {
  if (typeof text !== 'string') return '';

  const sanitized = stripCodeFences(stripThinkTokens(text), {
    languages: ['json', 'javascript', 'js'],
  });

  if (/^\s*[\[{]/.test(sanitized)) {
    return sanitized.trim();
  }

  const objectStart = sanitized.indexOf('{');
  const objectEnd = sanitized.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    return sanitized.slice(objectStart, objectEnd + 1).trim();
  }

  const arrayStart = sanitized.indexOf('[');
  const arrayEnd = sanitized.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return sanitized.slice(arrayStart, arrayEnd + 1).trim();
  }

  return sanitized.trim();
}

export function extractHtmlText(text) {
  if (typeof text !== 'string') return '';

  const sanitized = stripCodeFences(stripThinkTokens(text), {
    languages: ['html', 'htm', 'xml'],
  });

  const htmlMatch = sanitized.match(/<!DOCTYPE html[\s\S]*$/i) || sanitized.match(/<html[\s\S]*<\/html>/i);
  if (htmlMatch) {
    return htmlMatch[0].trim();
  }

  return sanitized.trim();
}

export function extractSvgText(text) {
  if (typeof text !== 'string') return '';

  const sanitized = stripCodeFences(stripThinkTokens(text), {
    languages: ['svg', 'xml', 'html', 'htm'],
  });
  const svgMatch = sanitized.match(/<svg[\s\S]*?<\/svg>/i);
  return svgMatch ? svgMatch[0].trim() : sanitized.trim();
}

export function extractJavaScriptText(text) {
  if (typeof text !== 'string') return '';
  return stripCodeFences(stripThinkTokens(text), {
    languages: ['javascript', 'js', 'ts', 'tsx', 'jsx'],
  });
}

export function sanitizeGeneratedOutput(text, { contentType = 'text' } = {}) {
  switch (contentType) {
    case 'json':
      return extractJsonText(text);
    case 'html':
      return extractHtmlText(text);
    case 'svg':
      return extractSvgText(text);
    case 'javascript':
    case 'js':
    case 'code':
      return extractJavaScriptText(text);
    default:
      return stripCodeFences(stripThinkTokens(text));
  }
}
