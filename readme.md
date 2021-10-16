### Class to TS Types

A simple tool to extract DTOs from a project (like NestJS) and convert them to plain TS Types.

### Usage

Install as dev-dependency

```
npm i --save-dev @tauqeernasir/class2type

yarn add -D @tauqeernasir/class2type
```

```json
{
  "script": "class2type --pattern='*.dto.ts' --outDir='./types' --outFile='dist-types.ts' --namespace='projectName'"
}
```
