export type DocumentErrorCode = 'invalid-document' | 'unsupported-version' | 'too-large';

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;

  constructor(message: string, code: DocumentErrorCode = 'invalid-document') {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
  }
}
