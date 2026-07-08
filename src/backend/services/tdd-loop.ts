import { ChatMessage, IModelProvider } from '../models/abstract.js';
import { extractJson } from '../core/utils/json-cleaner.js';

export interface GeneratedFile {
  path: string;
  content: string;
}

interface GenerationResponse {
  files?: GeneratedFile[];
  explanation?: string;
  testCommand?: string;
}

export interface TestRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface TDDDeps {
  writeFile(path: string, content: string): Promise<void>;
  runCommand(command: string, timeout: number): Promise<TestRunResult>;
}

export interface TDDOptions {
  maxAttempts?: number;
  testCommand?: string;
  /** Timeout initial en ms — doublé après chaque timeout (spec §3.3). */
  timeout?: number;
}

export interface TDDCallbacks {
  onAttemptStart?(attempt: number, maxAttempts: number): void;
  onFilesGenerated?(files: GeneratedFile[], explanation?: string): void;
  onTestResult?(result: TestRunResult, attempt: number): void;
}

export interface TDDResult {
  success: boolean;
  attempts: number;
  filesWritten: string[];
  lastTestOutput: string;
  explanation?: string;
  error?: string;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_TIMEOUT = 30000;

const TDD_SYSTEM_PROMPT = [
  'Tu es Jarvis en mode Auto-TDD : tu écris du code qui doit faire passer les tests.',
  'Tu DOIS répondre avec UN SEUL objet JSON, sans texte autour:',
  '{"explanation": "résumé court", "files": [{"path": "chemin/relatif.ts", "content": "contenu complet du fichier"}]}',
  'Règles:',
  '- Fournis le contenu COMPLET de chaque fichier (pas de fragments).',
  '- Modifie uniquement les fichiers nécessaires.',
  '- Corrige la cause racine des échecs de tests, pas les symptômes.'
].join('\n');

/** Tronque la sortie de test pour ne garder que la fin (là où sont les erreurs). */
export function summarizeTestOutput(stdout: string, stderr: string, maxChars = 4000): string {
  const combined = `${stdout}\n${stderr}`.trim();
  if (combined.length <= maxChars) return combined;
  return '… (début tronqué)\n' + combined.slice(combined.length - maxChars);
}

/**
 * Boucle Auto-TDD (spec §3.3) :
 * générer code → écrire fichiers → exécuter tests → analyser → corriger,
 * maximum `maxAttempts` tentatives.
 */
export class AutoTDDLoop {
  constructor(
    private provider: IModelProvider,
    private deps: TDDDeps
  ) {}

  public async run(task: string, options: TDDOptions = {}, callbacks: TDDCallbacks = {}): Promise<TDDResult> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const testCommand = options.testCommand ?? 'npm test';
    let timeout = options.timeout ?? DEFAULT_TIMEOUT;

    const messages: ChatMessage[] = [
      { role: 'system', content: TDD_SYSTEM_PROMPT },
      { role: 'user', content: `Tâche: ${task}\nCommande de test: ${testCommand}` }
    ];

    const filesWritten = new Set<string>();
    let lastTestOutput = '';
    let lastExplanation: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      callbacks.onAttemptStart?.(attempt, maxAttempts);

      // 1-2. Générer le code
      let raw: string;
      try {
        const res = await this.provider.sendPrompt(messages);
        raw = typeof res === 'string' ? res : res.text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          attempts: attempt,
          filesWritten: [...filesWritten],
          lastTestOutput,
          error: `Erreur du modèle: ${msg}`
        };
      }

      const parsed = extractJson<GenerationResponse>(raw);
      if (!parsed.ok || !parsed.value?.files?.length) {
        messages.push({ role: 'assistant', content: raw });
        messages.push({
          role: 'user',
          content: 'Réponse invalide. Réponds UNIQUEMENT avec le JSON demandé: {"explanation": "...", "files": [{"path": "...", "content": "..."}]}'
        });
        continue;
      }

      const { files, explanation } = parsed.value;
      lastExplanation = explanation;
      callbacks.onFilesGenerated?.(files!, explanation);

      // 3. Écrire/éditer les fichiers
      try {
        for (const file of files!) {
          await this.deps.writeFile(file.path, file.content);
          filesWritten.add(file.path);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        messages.push({ role: 'assistant', content: raw });
        messages.push({ role: 'user', content: `Échec d'écriture: ${msg}. Adapte les chemins et réessaie.` });
        continue;
      }

      // 4. Exécuter les tests
      const result = await this.deps.runCommand(testCommand, timeout);
      lastTestOutput = summarizeTestOutput(result.stdout, result.stderr);
      callbacks.onTestResult?.(result, attempt);

      // 5. Analyser
      if (result.success) {
        return {
          success: true,
          attempts: attempt,
          filesWritten: [...filesWritten],
          lastTestOutput,
          explanation: lastExplanation
        };
      }

      if (result.timedOut) {
        // Augmentation progressive du timeout (spec §3.3)
        timeout *= 2;
      }

      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: [
          `Les tests échouent (tentative ${attempt}/${maxAttempts})${result.timedOut ? ' — TIMEOUT' : ''}.`,
          'Sortie des tests:',
          '```',
          lastTestOutput,
          '```',
          'Analyse la cause de l\'échec et génère une correction ciblée (JSON uniquement).'
        ].join('\n')
      });
    }

    return {
      success: false,
      attempts: maxAttempts,
      filesWritten: [...filesWritten],
      lastTestOutput,
      explanation: lastExplanation,
      error: `Échec après ${maxAttempts} tentatives`
    };
  }
}
