### Class to TS Types

A simple tool to extract DTOs from a project (like NestJS) and convert them to plain TS Types.

> It was mainly developed for NestJS project to export all DTOs so that they could be used in other projects, like frontend.

### Features Roadmap

- [x] Class to plain TS Type
- [x] when class is empty or output no properties use Record<string,any>
- [x] keep JSDoc comments
- [x] import and properly refer to enums
- [ ] import and properly refer to imported types

### Usage

Install as dev-dependency

```
npm i --save-dev @tauqeernasir/class2type

yarn add -D @tauqeernasir/class2type
```

Use following script to run the exporter

```json
{
  "script": "class2type --pattern '/src/**/*.dto.ts' --outDir './types' --outFile 'dist-types.ts' --namespace 'projectName'"
}
```
