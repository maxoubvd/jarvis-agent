export interface SecretMatch {
  type: string;
  match: string;
  position: number;
}

export interface ScrubResult {
  cleaned: string;
  foundSecrets: SecretMatch[];
}

export class SecretScrubber {
  private patterns: Array<{ regex: RegExp; type: string }>;

  constructor() {
    this.patterns = [
      { regex: /sk-[a-zA-Z0-9]{32,}/g, type: 'OpenAI/OpenRouter API Key' },
      { regex: /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+/g, type: 'JWT Token' },
      { regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/g, type: 'Private Key' },
      { regex: /(?:password|passwd|pwd|secret|token|apikey|api_key)\s*[=:]\s*["']?[^\s"',;}{]{4,}/gi, type: 'Password/Secret' },
      { regex: /AKIA[0-9A-Z]{16}/g, type: 'AWS Access Key' },
      { regex: /ghp_[a-zA-Z0-9]{36}/g, type: 'GitHub Personal Access Token' },
      { regex: /ghs_[a-zA-Z0-9]{36}/g, type: 'GitHub Server Token' },
      { regex: /sk-or-v1-[a-zA-Z0-9]{48,}/g, type: 'OpenRouter API Key' },
      { regex: /mysql:\/\/[^\s@]+@[^\s/]+\/[^\s]+/g, type: 'MySQL Connection String' },
      { regex: /postgres(?:ql)?:\/\/[^\s@]+@[^\s/]+\/[^\s]+/g, type: 'PostgreSQL Connection String' },
      { regex: /mongodb(?:\+srv)?:\/\/[^\s@]+@[^\s/]+\/[^\s]+/g, type: 'MongoDB Connection String' }
    ];
  }

  public scrub(text: string): ScrubResult {
    const foundSecrets: SecretMatch[] = [];
    let cleaned = text;

    for (const { regex, type } of this.patterns) {
      regex.lastIndex = 0;
      const matches = [...text.matchAll(regex)];
      for (const match of matches) {
        foundSecrets.push({
          type,
          match: match[0].substring(0, 20) + '...',
          position: match.index ?? 0
        });
      }
      regex.lastIndex = 0;
      cleaned = cleaned.replace(regex, `[${type.toUpperCase().replace(/\s+/g, '_')}_REDACTED]`);
    }

    return { cleaned, foundSecrets };
  }

  public hasSecrets(text: string): boolean {
    return this.scrub(text).foundSecrets.length > 0;
  }
}
