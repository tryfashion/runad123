import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const restricted = ['apps/extension/src', 'packages/contracts/src', 'packages/product-core/src'];
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}
let failures = 0;
for (const dir of restricted) {
  for (const file of files(dir).filter((file) => /\.tsx?$/.test(file))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        specifier = node.moduleSpecifier;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(source) === 'require')
      )
        specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) {
        const value = specifier.text;
        if (
          /^(node:|@runad123\/(db|server-core)(\/|$)|mysql2|drizzle-orm)/.test(value) ||
          /(?:^|\/)server-core\//.test(value)
        ) {
          console.error(`Forbidden browser dependency: ${file} -> ${value}`);
          failures++;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
if (failures) process.exitCode = 1;
else console.log('Browser package boundaries checked.');
