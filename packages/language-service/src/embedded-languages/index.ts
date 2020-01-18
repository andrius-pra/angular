import * as ts from 'typescript/lib/tsserverlibrary';
import {getCSSLanguageService} from 'vscode-css-languageservice';
import {getLanguageService} from 'vscode-html-languageservice';
import {Configuration} from './configuration';
import {EmbeddedTemplateLanguageService} from './embedded-template-language-service';
import {Logger, TemplateSettings, decorateWithTemplateLanguageService} from './typescript-template-language-service-decorator';
import {VirtualDocumentProvider} from './virtual_document_provider';

const uniquePluginSymbol = Symbol('__angularEmbededLanguageServicePluginMarker__');

class LanguageServiceLogger implements Logger {
  constructor(private readonly info: ts.server.PluginCreateInfo) {}

  public log(msg: string) {
    this.info.project.projectService.logger.info(`[AngularEmbededLanguageService] ${msg}`);
  }
}

class EmbededLanguagePlugin {
  private readonly _virtualDocumentProvider = new VirtualDocumentProvider();
  private readonly _cssLanguageService = getCSSLanguageService();
  private readonly _htmlLanguageService = getLanguageService();

  private _config = new Configuration();
  public constructor(private readonly _typescript: typeof ts) {}

  public create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const logger = new LanguageServiceLogger(info);

    if ((info.languageService as any)[uniquePluginSymbol]) {
      // Already decorated
      return info.languageService;
    }

    this._config.update(info.config);

    const embeddedTemplateLanguageService = new EmbeddedTemplateLanguageService(
        this._typescript, this._config, this._virtualDocumentProvider, this._htmlLanguageService,
        this._cssLanguageService);

    const languageService = decorateWithTemplateLanguageService(
        this._typescript, info.languageService, info.project, embeddedTemplateLanguageService,
        this.getTemplateSettings(), {logger});

    (languageService as any)[uniquePluginSymbol] = true;
    return languageService;
  }

  public onConfigurationChanged(config: any) { this._config.update(config); }

  private getTemplateSettings(): TemplateSettings {
    return {tags: [], enableForStringWithSubstitutions: false};
  }
}

export const EmbededLanguagePluginFactory = (mod: {typescript: typeof ts}) =>
    new EmbededLanguagePlugin(mod.typescript);