import * as vscode from 'vscode'
import * as YAML from 'yaml'

interface YAMLParseError extends Error {
  code?: string
  pos?: [number, number]
  linePos?: [{ line: number; col: number }, { line: number; col: number }]
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/

class YamlFrontmatterValidator {
  private diagnosticCollection: vscode.DiagnosticCollection

  constructor(context: vscode.ExtensionContext) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('yaml-frontmatter')

    context.subscriptions.push(
      this.diagnosticCollection,
      // Validate on save
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (this.isMarkdownFile(doc)) {
          this.validateDocument(doc)
        }
      }),
      // Validate on open
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (this.isMarkdownFile(doc)) {
          this.validateDocument(doc)
        }
      }),
      // Validate on change
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.isMarkdownFile(event.document)) {
          this.validateDocument(event.document)
        }
      }),
      // Clear diagnostics when document closes
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.diagnosticCollection.delete(doc.uri)
      }),
    )

    // Validate all open markdown documents on activation
    vscode.workspace.textDocuments.forEach((doc) => {
      if (this.isMarkdownFile(doc)) {
        this.validateDocument(doc)
      }
    })
  }

  private isMarkdownFile(document: vscode.TextDocument): boolean {
    return document.languageId === 'markdown'
  }

  private validateDocument(document: vscode.TextDocument) {
    const text = document.getText()
    const match = text.match(FRONTMATTER_REGEX)

    if (!match) {
      // No frontmatter - clear any existing diagnostics
      this.diagnosticCollection.delete(document.uri)
      return
    }

    const yamlContent = match[1]
    const hasCarriageReturn = match[0].startsWith('---\r\n')
    const frontmatterStartOffset = hasCarriageReturn ? 5 : 4 // "---\n" or "---\r\n"

    try {
      YAML.parse(yamlContent)
      // Valid YAML - clear diagnostics
      this.diagnosticCollection.delete(document.uri)
    } catch (err) {
      const yamlError = err as YAMLParseError
      const diagnostics: vscode.Diagnostic[] = []

      if (yamlError.linePos) {
        // YAML library provides 1-indexed line/col within the YAML content
        // We need to adjust for the frontmatter offset (line 1 of YAML is line 2 of document)
        const startLine = yamlError.linePos[0].line // 1-indexed line in YAML
        const startCol = yamlError.linePos[0].col - 1 // Convert to 0-indexed
        const endLine = yamlError.linePos[1]?.line ?? startLine
        const endCol = yamlError.linePos[1]?.col ?? startCol + 1

        // Adjust line numbers: YAML line 1 = document line 1 (after "---\n")
        const docStartLine = startLine // The "---" is line 0, so YAML line 1 = doc line 1
        const docEndLine = endLine

        const range = new vscode.Range(
          docStartLine,
          startCol,
          docEndLine,
          endCol,
        )

        const message = this.extractErrorMessage(yamlError)
        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error)
        diagnostic.source = 'YAML'
        diagnostic.code = yamlError.code
        diagnostics.push(diagnostic)
      } else if (yamlError.pos) {
        // Fallback: use character positions
        const startPos = document.positionAt(frontmatterStartOffset + yamlError.pos[0])
        const endPos = document.positionAt(frontmatterStartOffset + yamlError.pos[1])
        const range = new vscode.Range(startPos, endPos)

        const message = this.extractErrorMessage(yamlError)
        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error)
        diagnostic.source = 'YAML'
        diagnostic.code = yamlError.code
        diagnostics.push(diagnostic)
      } else {
        // No position info - highlight the entire frontmatter
        const range = new vscode.Range(0, 0, 0, 3) // Just highlight "---"
        const message = this.extractErrorMessage(yamlError)
        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error)
        diagnostic.source = 'YAML'
        diagnostics.push(diagnostic)
      }

      this.diagnosticCollection.set(document.uri, diagnostics)
    }
  }

  private extractErrorMessage(error: YAMLParseError): string {
    // Extract just the first line of the error message (most relevant part)
    const fullMessage = error.message || 'Unknown YAML error'
    const firstLine = fullMessage.split('\n')[0]
    return firstLine
  }

  dispose() {
    this.diagnosticCollection.dispose()
  }
}

let _validator: YamlFrontmatterValidator | undefined

export function activate(context: vscode.ExtensionContext) {
  _validator = new YamlFrontmatterValidator(context)
}

export function deactivate() {
  _validator?.dispose()
}
