import * as vscode from 'vscode';
import { Project } from 'ts-morph';

// --- Interfaces ---
interface EntityField {
  name: string;
  type: string;
  decorators?: string[];
}

interface EntityRelation {
  type: string; // e.g. OneToMany, ForeignKey
  target: string;
}

interface EntitySchema {
  name: string;
  fields: EntityField[];
  relations: EntityRelation[];
}

// --- Parser Strategy Pattern ---
interface EntityParser {
  canParse(fileExtension: string): boolean;
  parse(filePaths: string[]): EntitySchema[];
}

// --- TypeScript (TypeORM/Prisma) Parser Implementation ---
class TypeScriptEntityParser implements EntityParser {
  canParse(fileExtension: string): boolean {
  return fileExtension.replace('.', '') === 'ts';
}

  parse(filePaths: string[]): EntitySchema[] {
    const project = new Project();
    project.addSourceFilesAtPaths(filePaths);

    const schemas: EntitySchema[] = [];

    project.getSourceFiles().forEach((sf) => {
      sf.getClasses().forEach((cls) => {
        const entityDecorator = cls.getDecorator('Entity');
        if (!entityDecorator) {return;} // only handle @Entity classes

        const fields: EntityField[] = [];
        const relations: EntityRelation[] = [];

        cls.getProperties().forEach((prop) => {
          const field: EntityField = {
            name: prop.getName(),
            type: prop.getType().getText(),
            decorators: prop.getDecorators().map((d) => d.getName()),
          };
          fields.push(field);

          // crude relation detection
          const rel = prop.getDecorators().find((d) =>
            ['OneToMany', 'ManyToOne', 'OneToOne', 'ManyToMany'].includes(
              d.getName()
            )
          );
          if (rel) {
            relations.push({
              type: rel.getName(),
              target: 'UnknownTarget', // TODO: resolve decorator arguments
            });
          }
        });

        schemas.push({
          name: cls.getName() || 'UnnamedEntity',
          fields,
          relations,
        });
      });
    });

    return schemas;
  }
}

// --- Placeholder Parsers ---
class PythonEntityParser implements EntityParser {
  canParse(fileExtension: string): boolean {
    return fileExtension === 'py';
  }
  parse(filePaths: string[]): EntitySchema[] {
    vscode.window.showWarningMessage('Python parser not yet implemented.');
    return [];
  }
}

class JavaEntityParser implements EntityParser {
  canParse(fileExtension: string): boolean {
    return fileExtension === 'java';
  }
  parse(filePaths: string[]): EntitySchema[] {
    vscode.window.showWarningMessage('Java parser not yet implemented.');
    return [];
  }
}

// --- UML Generator ---
function generateMermaidUML(schemas: EntitySchema[]): string {
  if (!schemas || schemas.length === 0) {
    // Provide a fallback diagram (valid mermaid syntax)
    return `classDiagram
    class Empty {
      note "No entities found"
    }`;
  }

  let uml = 'classDiagram\n';

  schemas.forEach((schema) => {
    uml += `  class ${schema.name} {\n`;
    schema.fields.forEach((f) => {
      uml += `    ${f.type} ${f.name}\n`;
    });
    uml += '  }\n';

    schema.relations.forEach((rel) => {
      uml += `  ${schema.name} --> ${rel.target} : ${rel.type}\n`;
    });
  });

  console.log('Generated UML:\n', uml); // ✅ debug output
  vscode.window.showInformationMessage(`Schemas parsed: ${schemas.length}`);
  return uml;
}

// --- Extension Entry Point ---
export function activate(context: vscode.ExtensionContext) {
  const parsers: EntityParser[] = [
    new TypeScriptEntityParser(),
    new PythonEntityParser(),
    new JavaEntityParser(),
  ];

  const disposable = vscode.commands.registerCommand(
    'entityUML.generate',
    async () => {
      const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Entities Folder',
      });

      if (!folderUri || folderUri.length === 0) {return;}

      const folderPath = folderUri[0].fsPath;
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folderPath, '**/*.{ts,py,java}')
      );

      let schemas: EntitySchema[] = [];
      for (const parser of parsers) {
        const relevantFiles = files.filter((f) =>
          parser.canParse('.' + (f.fsPath.split('.').pop() || ''))
        );
        if (relevantFiles.length > 0) {
          schemas = schemas.concat(
            parser.parse(relevantFiles.map((f) => f.fsPath))
          );
        }
      }

      const uml = generateMermaidUML(schemas);

      const panel = vscode.window.createWebviewPanel(
        'entityUMLPreview',
        'Entity UML Diagram',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = `<html><body>
        <h2>Entity UML Preview</h2>
        <pre>${uml}</pre>
        <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
        <div class="mermaid">${uml}</div>
        <script>mermaid.initialize({ startOnLoad: true });</script>
      </body></html>`;
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}