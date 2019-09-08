/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as tss from 'typescript/lib/tsserverlibrary'; // used as type only

import {createLanguageService} from './language_service';
import {TypeScriptServiceHost} from './typescript_host';

const projectHostMap = new WeakMap<tss.server.Project, TypeScriptServiceHost>();

function tryCall<T>(callback: () => T): T | undefined {
  try {
      return callback();
  } catch (e) {
      return undefined;
  }
}

export function getExternalFiles(project: tss.server.Project): string[]|undefined {
  const host = projectHostMap.get(project);
  if (host) {
    host.getAnalyzedModules();
    const externalFiles = host.getTemplateReferences();
    return externalFiles;
  }
}

export function create(info: tss.server.PluginCreateInfo): tss.LanguageService {
  const {project, languageService: tsLS, languageServiceHost: tsLSHost, config} = info;
  // This plugin could operate under two different modes:
  // 1. TS + Angular
  //    Plugin augments TS language service to provide additional Angular
  //    information. This only works with inline templates and is meant to be
  //    used as a local plugin (configured via tsconfig.json)
  // 2. Angular only
  //    Plugin only provides information on Angular templates, no TS info at all.
  //    This effectively disables native TS features and is meant for internal
  //    use only.
  const angularOnly = config ? config.angularOnly === true : false;
  const ngLSHost = new TypeScriptServiceHost(tsLSHost, tsLS);
  const ngLS = createLanguageService(ngLSHost);
  projectHostMap.set(project, ngLSHost);

  function getCompletionsAtPosition(
      fileName: string, position: number,
      options: tss.GetCompletionsAtPositionOptions | undefined) {
    if (!angularOnly) {
      const results = tryCall(() => tsLS.getCompletionsAtPosition(fileName, position, options));
      if (results && results.entries.length) {
        // If TS could answer the query, then return results immediately.
        return results;
      }
    }
    return ngLS.getCompletionsAt(fileName, position);
  }

  function getQuickInfoAtPosition(fileName: string, position: number): tss.QuickInfo|undefined {
    if (!angularOnly) {
      const result = tryCall(() => tsLS.getQuickInfoAtPosition(fileName, position));
      if (result) {
        // If TS could answer the query, then return results immediately.
        return result;
      }
    }
    return ngLS.getHoverAt(fileName, position);
  }

  function getSemanticDiagnostics(fileName: string): tss.Diagnostic[] {
    const results: tss.Diagnostic[] = [];
    if (!angularOnly) {
      results.push(...tryCall(() => tsLS.getSemanticDiagnostics(fileName)) || []);
    }
    // For semantic diagnostics we need to combine both TS + Angular results
    results.push(...ngLS.getDiagnostics(fileName));
    return results;
  }

  function getDefinitionAtPosition(
      fileName: string, position: number): ReadonlyArray<tss.DefinitionInfo>|undefined {
    if (!angularOnly) {
      const results = tryCall(() => tsLS.getDefinitionAtPosition(fileName, position));
      if (results) {
        // If TS could answer the query, then return results immediately.
        return results;
      }
    }
    const result = ngLS.getDefinitionAt(fileName, position);
    if (!result || !result.definitions || !result.definitions.length) {
      return;
    }
    return result.definitions;
  }

  function getDefinitionAndBoundSpan(
      fileName: string, position: number): tss.DefinitionInfoAndBoundSpan|undefined {
    if (!angularOnly) {
      const result = tryCall(() => tsLS.getDefinitionAndBoundSpan(fileName, position));
      if (result) {
        // If TS could answer the query, then return results immediately.
        return result;
      }
    }
    return ngLS.getDefinitionAt(fileName, position);
  }

  const proxy: tss.LanguageService = Object.assign(
      // First clone the original TS language service
      {}, tsLS,
      // Then override the methods supported by Angular language service
      {
          getCompletionsAtPosition, getQuickInfoAtPosition, getSemanticDiagnostics,
          getDefinitionAtPosition, getDefinitionAndBoundSpan,
      });
  return proxy;
}
