#!/usr/bin/env node
/**
 *
 * Example usage:
 *
 *          ts-node ./.scripts/export-types -p "/src/**\/*dto.ts" -o /sdk -f definitions.d.ts -n VendorPlaformApi
 *
 * - [x] class to types
 * - [x] when class is empty or output no properties use Record<string,any>
 * - [x] keep JSDoc comments
 * - [ ] import and properly refer to imported types and include all used enums (Enum part is done)
 */

import * as cla from "command-line-args";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { format } from "prettier";
import {
  ClassDeclaration,
  Project,
  PropertyDeclaration,
  SourceFile,
  SyntaxKind,
} from "ts-morph";

let project: Project;
let currentFile: SourceFile;
// to keep enums and other global declarations
let globalContent = "";
let classTypeMaps = {};

const optionDefinitions = [
  { name: "pattern", alias: "p", type: String, multiple: true },
  { name: "outDir", alias: "o", type: String },
  { name: "outFile", alias: "f", type: String },
  { name: "namespace", alias: "n", type: String },
];

type ExtendArgsType = {
  isPartial: boolean;
  arg: string;
};

function readCliOptions(opts) {
  const cliOptions = cla(opts);

  if (!cliOptions.pattern?.length) {
    throw new Error("Please provide --pattern for source files");
  }

  if (!cliOptions.outDir) {
    throw new Error("Please provide --outDir for output directory");
  }

  if (!cliOptions.outFile) {
    throw new Error("Please provide --outFile for output filename");
  }

  if (!cliOptions.namespace) {
    throw new Error("Please provide --namespace for exported namespace");
  }

  return cliOptions;
}

function run() {
  const cliOptions = readCliOptions(optionDefinitions);

  const outputDirectory = path.resolve(
    path.join(process.cwd(), cliOptions.outDir)
  );
  project = new Project();

  if (!existsSync(outputDirectory)) {
    mkdirSync(outputDirectory);
  }

  const paths = cliOptions.pattern.map((filePath: string) => {
    return path.resolve(process.cwd() + filePath);
  });
  const files: SourceFile[] = project.addSourceFilesAtPaths(paths);

  const filesToWrite: { filename: string; content: string }[] = [];

  files.forEach((file: SourceFile) => {
    currentFile = file;
    const filename = file.getBaseName();

    let content = `
           // ${filename}
       `;

    file.getClasses().forEach((c) => {
      const className = c.getName() as string;

      const classComment = c
        .getJsDocs()
        .map((j) => j.getText())
        .join("");

      const properties = getPropertiesInTextFormat(c);
      let extendArgs: ExtendArgsType[] = [];

      c.getExtends()?.forEachChild((node) => {
        /**
         * Handle call expression which we use like: ... extends PartialType(SomeType)
         */

        if (node.getKind() === SyntaxKind.CallExpression) {
          if (
            node?.getFirstChild()?.getText()?.toLowerCase() ===
            "PartialType".toLowerCase()
          ) {
            /**
             * Handle partial type values
             */
            node.getChildrenOfKind(SyntaxKind.SyntaxList).forEach((sl) => {
              extendArgs.push({
                arg: sl.getText().replace(",", ""),
                isPartial: true,
              });
            });
          }
        }

        /**
         * Handle normal extend
         */
        if (node.getKind() === SyntaxKind.Identifier) {
          extendArgs.push({
            arg: node.getText().replace(",", ""),
            isPartial: false,
          });
        }
      });

      if (extendArgs.length) {
        const extClassContent = getExtendedClassContent({
          className,
          extendArgs,
          classComment,
          properties,
        });

        classTypeMaps[className] = extClassContent;

        content += extClassContent;
      } else {
        const normalClassContent = getNormalClassContent({
          className,
          classComment,
          properties,
        });

        classTypeMaps[className] = normalClassContent;

        content += normalClassContent;
      }
    });

    filesToWrite.push({ filename, content });

    const innerContent = filesToWrite
      .map((f) => {
        return `${f.content}\n\n`;
      })
      .join("");
    const finalContent = getFinalContentTemplate(
      cliOptions.namespace,
      `${globalContent} ${innerContent}`
    );

    // temp file to contain all types to be used in SDK
    writeFile(
      path.resolve(path.join(process.cwd(), cliOptions.outDir, "types.temp")),
      `${globalContent} ${innerContent}`
    );

    writeFile(
      path.resolve(
        path.join(process.cwd(), cliOptions.outDir, cliOptions.outFile)
      ),
      format(finalContent, {
        semi: true,
        bracketSpacing: true,
        tabWidth: 2,
        parser: "typescript",
        singleQuote: true,
      })
    );
  });

  console.info("\u001b[34mTotal files scanned: " + files.length);
  console.info(
    `✅ \u001b[32mTypes has been generated successfully! (.${cliOptions.outDir}/${cliOptions.outFile})`
  );

  // create a type-meta.json file for tracking and using in sdk
  // writeFile(
  //   path.resolve(process.cwd() + '/sdk/types-meta.json'),
  //   JSON.stringify(classTypeMaps, null, 2),
  // );
}

function writeFile(filename: string, content: string) {
  writeFileSync(filename, content, { encoding: "utf-8" });
}

function getExtendedType(arg) {
  if (arg.isPartial) {
    return `Partial<${arg.arg}>`;
  } else {
    return arg.arg;
  }
}

function getTypePropertiesOrReturnAnyRecord(
  properties: any[],
  isExtending: boolean = false
) {
  if (properties.length) {
    return `${isExtending ? "& " : ""} {
               ${properties.join(";\n")}
           };`;
  } else {
    return isExtending ? "" : `Record<string, any>`;
  }
}

function getRefType(p: PropertyDeclaration): "enum" | "typeAlias" | null {
  if (p?.compilerNode?.type?.kind === SyntaxKind.TypeReference) {
    if (p.getType().isEnum()) {
      return "enum";
    }
    return "typeAlias";
  }
  return null;
}

function getPropertiesInTextFormat(c: ClassDeclaration) {
  return c.getProperties().map((p) => {
    const {
      hasQuestionToken: isOptional,
      name: propertyName,
      type: propertyValue,
    } = p.getStructure();

    const typeKind = getRefType(p);
    const isEnumValue = typeKind === "enum";
    const isTypeRefValue = typeKind === "typeAlias";

    if (isEnumValue) {
      const foundEnum = searchForEnumInFiles(
        currentFile,
        propertyValue?.toString()
      );
      if (foundEnum) {
        globalContent += foundEnum;
      }
    }

    if (isTypeRefValue) {
      const foundTypeAlias = searchForTypeAliasInFiles(
        currentFile,
        propertyValue?.toString()
      );

      if (foundTypeAlias) {
        globalContent += foundTypeAlias;
      }
    }

    return `
               ${p
                 .getJsDocs()
                 .map((j) => j.getText())
                 .join("")}
                 ${propertyName}${isOptional ? "?" : ""}: ${propertyValue}
                 `;
  });
}

function getFinalContentTemplate(namespace: string, innerContent: string) {
  return `
           namespace ${namespace} {
               ${innerContent}
           }
       `;
}

type GetExtendedClassContentParams = {
  classComment?: string;
  className: string;
  extendArgs: ExtendArgsType[];
  properties: string[];
};
function getExtendedClassContent(params: GetExtendedClassContentParams) {
  const { className, classComment, extendArgs, properties } = params;
  const resolvedArgs = extendArgs.map((arg) => getExtendedType(arg)).join("& ");

  return `
       ${classComment}
       export type ${className} = ${resolvedArgs}
       ${getTypePropertiesOrReturnAnyRecord(properties, true)};`;
}

type GetNormalClassContentParams = {
  classComment?: string;
  className: string;

  properties: string[];
};
function getNormalClassContent(params: GetNormalClassContentParams) {
  const { className, classComment, properties } = params;
  return `
       ${classComment}
       export type ${className} = ${getTypePropertiesOrReturnAnyRecord(
    properties
  )};`;
}

function findAndExtractEnumTextFromFile(file: SourceFile, enumName: string) {
  const foundEnum = file.getEnum(enumName)?.getText();

  if (!foundEnum) {
    return null;
  }

  return foundEnum;
}

function findAndExtractTypeTextFromFile(file: SourceFile, aliasName: string) {
  const foundEnum = file.getTypeAlias(aliasName)?.getText();

  if (!foundEnum) {
    return null;
  }

  return foundEnum;
}

function searchForEnumInFiles(currentFile, enumValue) {
  // include the enum value in final output
  let foundEnum = findAndExtractEnumTextFromFile(currentFile, enumValue);

  // if enum is not found in current file, try finding import declaration and read the file
  if (!foundEnum) {
    const importedModule = currentFile
      .getImportDeclarations()
      .find((d) =>
        (d.getStructure().namedImports as any).find(
          (ni) => ni.name === enumValue
        )
      );

    if (!importedModule) {
      throw new Error(
        "Could not find import declaration for enum " + enumValue
      );
    }

    const specifier = importedModule.getStructure().moduleSpecifier + ".ts";

    const specifiedFile = project.getSourceFile(
      path.resolve(currentFile.getDirectoryPath(), specifier)
    );

    if (!specifiedFile) {
      throw new Error("could not find file at path " + specifier);
    }

    foundEnum = findAndExtractEnumTextFromFile(specifiedFile, enumValue);
    return `
       // ${specifier.split("/").pop()}
       ${foundEnum?.indexOf("export") !== 1 ? "export" : ""} ${foundEnum}\n\n`;
  }

  return `${
    foundEnum.indexOf("export") !== 1 ? "export" : ""
  } ${foundEnum}\n\n`;
}

function searchForTypeAliasInFiles(currentFile, aliasValue) {
  // include the type value in final output
  let foundAlias = findAndExtractTypeTextFromFile(currentFile, aliasValue);

  // if type is not found in current file, try finding import declaration and read the file
  if (!foundAlias) {
    const importedModule = currentFile
      .getImportDeclarations()
      .find((d) =>
        (d.getStructure().namedImports as any).find(
          (ni) => ni.name === aliasValue
        )
      );

    if (!importedModule) {
      throw new Error(
        "Could not find import declaration for typeAlias " + aliasValue
      );
    }

    const specifier = importedModule.getStructure().moduleSpecifier + ".ts";

    const specifiedFile = project.getSourceFile(
      path.resolve(currentFile.getDirectoryPath(), specifier)
    );

    if (!specifiedFile) {
      throw new Error("could not find file at path " + specifier);
    }

    foundAlias = findAndExtractTypeTextFromFile(specifiedFile, aliasValue);
    return `
         // ${specifier.split("/").pop()}
         ${
           foundAlias?.indexOf("export") !== 1 ? "export" : ""
         } ${foundAlias}\n\n`;
  }

  return `${
    foundAlias.indexOf("export") !== 1 ? "export" : ""
  } ${foundAlias}\n\n`;
}

try {
  run();
} catch (e) {
  console.log("❌ \u001b[31m There was an error while generating types");
  console.error("\u001b[33m" + (e as any).message);
  process.exit(1);
}

/**
 * Reference enums
 * 1. Try finding the enum in the same file, if decalred, use that.
 * 2. If not in the same file, it must be imported into the file, so check for import statements and find if enum is being imported.
 *      And get that file and read the enum from there.
 */
