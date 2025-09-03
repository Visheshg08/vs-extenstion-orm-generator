import * as vscode from "vscode";
import { Parser as NodeSQLParser } from "node-sql-parser";
import { parse as pgParse } from "pgsql-ast-parser";


interface TableRelation {
  name: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: string; // many-to-one, one-to-many, etc.
}

interface TableSchema {
  name: string;
  columns: TableColumn[];
  relations?: TableRelation[];
}

interface TableColumn {
  name: string;
  type: string;
  isPrimary?: boolean;
  isForeign?: boolean;
  isUnique?: boolean;
  references?: { table: string; column: string };
}

function parseRelationshipFile(content: string): TableRelation[] {
  const relations: TableRelation[] = [];
  const lines = content.split("\n");

  const regex = /^Ref\s+(\w+):\s+(\w+)\.(\w+)\s*>\s*(\w+)\.(\w+)\s*\/\/\s*(.+)$/;

  lines.forEach((line) => {
    const match = line.match(regex);
    if (match) {
      relations.push({
        name: match[1],
        sourceTable: match[2],
        sourceColumn: match[3],
        targetTable: match[4],
        targetColumn: match[5],
        type: match[6].trim(),
      });
    }
  });

  return relations;
}


function detectDatabase(sql: string): "Postgres" | "MySQL" | "SQLite" {
  const upper = sql.toUpperCase();

  if (upper.includes("SERIAL") || upper.includes("BYTEA") || upper.includes("::")) {
    return "Postgres";
  }
  if (upper.includes("AUTO_INCREMENT") || upper.includes("ENGINE=") || upper.includes("UNSIGNED")) {
    return "MySQL";
  }
  if (upper.includes("AUTOINCREMENT") || upper.includes("WITHOUT ROWID")) {
    return "SQLite";
  }

  return "Postgres"; // default fallback
}

export class SQLParser {
  private nodeParser = new NodeSQLParser();

  parse(fileContents: string[]): TableSchema[] {
    const tables: TableSchema[] = [];

    fileContents.forEach((sql) => {
      const dialect = detectDatabase(sql);
      console.log("Detected dialect:", dialect);

      if (dialect === "Postgres") {
        // --- Postgres parser ---
        try {
          const ast = pgParse(sql);
          ast.forEach((stmt: any) => {
            if (stmt.type === "create table") {
              const tableName = stmt.name.name;
              const columns: TableColumn[] = stmt.columns.map((col: any) => {
                const column: TableColumn = {
                  name: col.name.name,
                  type: col.dataType.name || "unknown",
                };
                if (col.constraints?.some((c: any) => c.type === "primary key")) {
                  column.isPrimary = true;
                }
                if (col.constraints?.some((c: any) => c.type === "unique")) {
                   column.isUnique = true;
            }
                return column;
              });

              // Handle table-level PKs
              stmt.constraints?.forEach((constraint: any) => {
                if (constraint.type === "primary key") {
                  constraint.columns.forEach((pkCol: any) => {
                    const col = columns.find((c) => c.name === pkCol.name);
                    if (col) col.isPrimary = true;
                  });
                }
              });

              tables.push({ name: tableName, columns });
            }

            if (stmt.type === "alter table") {
              const tableName = stmt.table.name;
              const table = tables.find((t) => t.name === tableName);
              if (!table) return;

              stmt.commands.forEach((cmd: any) => {
                if (cmd.type === "add constraint" && cmd.constraint.type === "foreign key") {
                  const colName = cmd.constraint.columns[0].name;
                  const refTable = cmd.constraint.foreignTable.name;
                  const refCol = cmd.constraint.foreignColumns[0].name;

                  const targetCol = table.columns.find((c) => c.name === colName);
                  if (targetCol) {
                    targetCol.isForeign = true;
                    targetCol.references = { table: refTable, column: refCol };
                  }
                }
              });
            }
          });
        } catch (err) {
          console.error("Postgres parse error:", err);
        }
      } else {
        // --- MySQL/SQLite parser ---
        let ast: any;
        try {
          ast = this.nodeParser.astify(sql, { database: "MySQL" });
        } catch (err) {
          console.error("MySQL/SQLite parse error:", err);
          return;
        }

        if (!Array.isArray(ast)) ast = [ast];

        ast.forEach((stmt: any) => {
          if (stmt.type === "create") {
            const tableName = stmt.table?.[0]?.table;
            if (!tableName) return;

            const columns: TableColumn[] = (stmt.create_definitions || [])
              .filter((col: any) => col.resource === "column")
              .map((col: any) => {
                const column: TableColumn = {
                  name: col.column?.column || "",
                  type: col.definition?.dataType || "unknown",
                };

                if (col.constraint_type === "primary key") {
                  column.isPrimary = true;
                }
                if (col.constraint_type === "unique") {
                  column.isUnique = true;
                }
                if (col.constraint_type === "foreign key") {
                  column.isForeign = true;
                  column.references = {
                    table: col.reference.definition[0].table,
                    column: col.reference.definition[0].column[0].column,
                  };
                }

                return column;
              });

            const table: TableSchema = { name: tableName, columns };

            // Handle table-level constraints (composite PKs, FKs)
            (stmt.create_definitions || [])
              .filter((def: any) => def.resource === "constraint")
              .forEach((constraint: any) => {
                if (constraint.constraint_type === "primary key") {
                  constraint.definition.forEach((pkCol: any) => {
                    const col = table.columns.find(
                      (c) => c.name.toLowerCase() === pkCol.column.toLowerCase()
                    );
                    if (col) col.isPrimary = true;
                  });
                }
                if (constraint.constraint_type === "foreign key") {
                  const fkCols = constraint.definition;
                  const refTable = constraint.reference.table;
                  const refCols = constraint.reference.definition;

                  fkCols.forEach((fkCol: any, idx: number) => {
                    const col = table.columns.find(
                      (c) => c.name.toLowerCase() === fkCol.column.toLowerCase()
                    );
                    if (col) {
                      col.isForeign = true;
                      col.references = {
                        table: refTable,
                        column: refCols[idx].column,
                      };
                    }
                  });
                }
              });

            tables.push(table);
          }
        });
      }
    });

    return tables;
  }
}
function generateMermaidERD(schemas: TableSchema[], relations: TableRelation[]): string {
  if (!schemas || schemas.length === 0) {
    return `erDiagram
      EMPTY {
        string note "No tables found"
      }`;
  }

  let erd = "erDiagram\n";

  // Tables + columns
  schemas.forEach((table) => {
    erd += `  ${table.name.toUpperCase()} {\n`;

    table.columns.forEach((col) => {
      let type = col.type.toUpperCase();
      const extras: string[] = [];

      if (col.isPrimary) extras.push("PK");
      if (col.isForeign) extras.push("FK");

      erd += `    ${type} ${col.name}${extras.length ? " " + extras.join(" ") : ""}\n`;
    });

    erd += "  }\n";
  });

  // Relationships from external "relationships.*" file
  relations.forEach((rel) => {
    let arrow = rel.type.includes("many") ? "||--o{" : "||--||";
    erd += `  ${rel.targetTable.toUpperCase()} ${arrow} ${rel.sourceTable.toUpperCase()}\n`;
  });

  // Relationships from detected FKs in schema
  schemas.forEach((table) => {
    table.columns.forEach((col) => {
      if (col.isForeign && col.references) {
        let arrow = "||--o{"; // default = one-to-many

        // detect one-to-one
        if (col.isPrimary || col.isUnique) {
          arrow = "||--||";
        }

        erd += `  ${col.references.table.toUpperCase()} ${arrow} ${table.name.toUpperCase()}\n`;
      }
    });
  });

  return erd;
}




// --- Extension Entry Point ---
export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "entityUML.generate",
    async () => {
      const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select SQL Migrations Folder",
      });

      if (!folderUri || folderUri.length === 0) return;

      const folderPath = folderUri[0].fsPath;
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folderPath, "**/*.sql")
      );

      if (files.length === 0) {
        vscode.window.showWarningMessage("No .sql files found in folder.");
        return;
      }

      // Read all SQL files
      const sqlContents: string[] = [];
      for (const f of files) {
        const doc = await vscode.workspace.openTextDocument(f);
        sqlContents.push(doc.getText());
      }

      // Parse SQL
      const parser = new SQLParser();
      const schemas = parser.parse(sqlContents);

      // Generate ERD

      const relFiles = await vscode.workspace.findFiles(
  new vscode.RelativePattern(folderPath, "relationships.*")
);

      let relations: TableRelation[] = [];
      if (relFiles.length > 0) {
        const relDoc = await vscode.workspace.openTextDocument(relFiles[0]);
        relations = parseRelationshipFile(relDoc.getText());
      }
      const erd = generateMermaidERD(schemas, relations);
      console.log("Generated ERD:\n", erd);

      // Show Webview
      const panel = vscode.window.createWebviewPanel(
        "entityUMLPreview",
        "Database ER Diagram",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );
      panel.webview.html = `<html>
  <head>
    <style>
      body { font-family: sans-serif; padding: 20px; }
      #buttons { margin-bottom: 20px; }
      button {
        margin-right: 10px;
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        background: #2563eb;
        color: white;
      }
      button:hover { background: #1e40af; }

      /* Watermark style */
      #watermark {
        margin-top: 20px;
        font-size: 12px;
        color: #888;
        text-align: right;
        font-style: italic;
      }
    </style>
  </head>
  <body>
    <h2>Database ER Diagram</h2>
    <div id="buttons">
      <button onclick="downloadMermaid()">Download .mmd</button>
      <button onclick="downloadSVG()">Download .svg</button>
      <button onclick="downloadPNG()">Download .png</button>
    </div>

    <pre>${erd}</pre>
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <div class="mermaid" id="diagram">${erd}</div>

    <!-- Watermark -->
    <div id="watermark">✨ Created with ❤️ by <b>github/Visheshg08</b></div>

    <script>
      mermaid.initialize({ startOnLoad: true });

      // Download raw Mermaid text
      function downloadMermaid() {
        const watermark = "\\n\\n%% Created with ❤️ by github/Visheshg08";
        const blob = new Blob([\`${erd}\${watermark}\`], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "diagram.mmd";
        link.click();
      }

      // Download rendered SVG
      function downloadSVG() {
        const svg = document.querySelector("#diagram svg");
        if (!svg) { alert("Diagram not rendered yet!"); return; }

        // Clone SVG so we can add watermark
        const clone = svg.cloneNode(true);
        const watermark = document.createElementNS("http://www.w3.org/2000/svg", "text");
        watermark.setAttribute("x", "95%");
        watermark.setAttribute("y", "98%");
        watermark.setAttribute("text-anchor", "end");
        watermark.setAttribute("font-size", "10");
        watermark.setAttribute("fill", "#888");
        watermark.setAttribute("font-style", "italic");
        watermark.textContent = "✨ Created by @Visheshg08";
        clone.appendChild(watermark);

        const serializer = new XMLSerializer();
        const source = serializer.serializeToString(clone);
        const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "diagram.svg";
        link.click();
      }

      // Download rendered PNG
      function downloadPNG() {
        const svg = document.querySelector("#diagram svg");
        if (!svg) { alert("Diagram not rendered yet!"); return; }

        const serializer = new XMLSerializer();
        const source = serializer.serializeToString(svg);

        const img = new Image();
        const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);

        img.onload = function() {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);

          // Add watermark bottom-right
          ctx.font = "12px sans-serif";
          ctx.fillStyle = "#888";
          ctx.textAlign = "right";
          ctx.fillText("✨ Created by @Visheshg08", canvas.width - 10, canvas.height - 10);

          URL.revokeObjectURL(url);

          canvas.toBlob((blob) => {
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "diagram.png";
            link.click();
          });
        };

        img.src = url;
      }
    </script>
  </body>
</html>`;


    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
