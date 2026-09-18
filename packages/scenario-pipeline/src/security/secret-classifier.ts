const privateKeyPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i;
const accessKeyPattern = /\bAKIA[0-9A-Z]{16}\b/;
const prefixedTokenPattern = /\b(?:sk-|ghp_)[A-Za-z0-9_-]{16,}/i;
const providerTokenPattern = /\b(?:(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AIza[A-Za-z0-9_-]{24,}|glpat-[A-Za-z0-9_-]{16,})/i;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/;
const sensitiveAssignmentName = String.raw`(?:api[_-]?key|secret|password|credential|access[_-]?token|authorization|aws[_-]?secret[_-]?access[_-]?key)`;
const quotedAssignmentPattern = new RegExp(`${sensitiveAssignmentName}\\s*["']?\\s*[:=]\\s*["']([^"'\\r\\n]{8,})["']`, "gi");
const unquotedAssignmentPattern = new RegExp(`(?:^|[\\s;])${sensitiveAssignmentName}\\s*=\\s*([^\\s,;#"']{8,})`, "gim");
const queryCredentialPattern = /[?&](?:api[_-]?key|secret|password|credential|access[_-]?token|authorization)=([^&\s"']{8,})/i;
const referenceValuePattern = /^(?:credentials?|config|settings|request|input|payload|form|user|process\.env)\.[A-Za-z_$][\w$]*$/i;

export function containsPotentialSecret(value: string): boolean {
  if (privateKeyPattern.test(value) || bearerPattern.test(value) || accessKeyPattern.test(value) || prefixedTokenPattern.test(value) || providerTokenPattern.test(value) || jwtPattern.test(value) || queryCredentialPattern.test(value)) return true;
  quotedAssignmentPattern.lastIndex = 0;
  if (quotedAssignmentPattern.test(value)) return true;
  unquotedAssignmentPattern.lastIndex = 0;
  for (const match of value.matchAll(unquotedAssignmentPattern)) {
    if (!referenceValuePattern.test(match[1])) return true;
  }
  return false;
}
