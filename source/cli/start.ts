// Copyright Zaiste. All rights reserved.
// Licensed under the Apache License, Version 2.0
import Debug from 'debug';
const debug = Debug('ks:start'); // eslint-disable-line no-unused-vars

import { join, parse, sep, extname } from 'path';
import color from 'chalk';
import { TypescriptCompiler } from '@poppinss/chokidar-ts';
import fs from 'fs-extra';
import postcss from 'postcss';
import WebSocket from "ws";
import { Routes, Response } from 'retes';
import { DiagnosticMessageChain } from 'typescript';
import { LspWatcher } from '@poppinss/chokidar-ts/build/src/LspWatcher';
import { install } from 'esinstall';
import * as _ from 'colorette';

import { App } from "../manifest";
import Kretes from '../';
import { parser } from '../parser';
// const SQLCompiler = require('../compiler/sql');
import { VueHandler } from '../machine/watcher';
import { notice, print } from '../util';
import { generateWebRPCOnClient, RemoteMethodList } from '../rpc';

const CWD = process.cwd();
const VERSION = require('../../package.json').version;


let stdout;

const reloadSQL = async (pool, file) => {
  const content = await fs.readFile(file);
  const isSQLFunction = content.toString().split(' ')[0].toLowerCase() === 'function';
  if (isSQLFunction) {
    const query = `create or replace ${content.toString()}`;
    try {
      const _r = await pool.query(query);
    } catch (error) {
      console.error(error.message);
    }
  }
};

let sockets = [];

const isDatabaseConfigured = () => {
  const config = require(join(CWD, 'config', 'default.json'));
  const { PGHOST, PGPORT, PGDATABASE, PGDATA } = process.env;
  return ("db" in config) || (PGHOST && PGPORT && PGDATABASE && PGDATA);
}

const start = async ({ port, database }) => {
  let routes: Routes = require(join(CWD, 'dist/config/server/routes')).default;

  const isDatabase = database ? database : isDatabaseConfigured();

  const app = new Kretes({ routes, isDatabase });
  const server = await app.start(port);

  server.on('connection', socket => {
    sockets.push(socket);
  });

  const wss = new WebSocket.Server({ server });
  wss.on('connection', socket => {
    App.WebSockets.add(socket)
    socket.send(JSON.stringify({ type: 'connected' }))
    socket.on('close', () => App.WebSockets.delete(socket))
  })

  wss.on('error', (error: Error & { code: string }) => {
    if (error.code !== 'EADDRINUSE') {
      console.error(`ws error:`)
      console.error(error)
    }
  })

  print(notice('Listening')(port));
  print(notice('Logs'));

  const onExit = async _signal => {
    console.log(color`  {grey Stoping...}`);
    server.close(async () => {
      process.exit(0);
    });
  }

  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);

  return [app, server];
};

const ExcludedDependencies = ['kretes'];

const handler = async ({ port, production, database }) => {
  print(notice('Kretes'));
  process.env.KRETES = production ? 'production' : 'development';

  const dependencies = getDependencies();
  print(notice('ESM'))
  if (dependencies.length > 0) {
    await install(dependencies, { dest: 'dist/modules', logger: { ...console, debug: () => {} }});
  }
  print(`${_.yellow(dependencies.length.toString())} compiled\n`)

  const compiler = new TypescriptCompiler(
    CWD,
    'config/server/tsconfig.json',
    require('typescript/lib/typescript')
  );
  const { error, config } = compiler.configParser().parse();

  if (error || !config || config.errors.length) {
    return;
  }

  let server;
  let app;

  const watcher = compiler.watcher(config, 'lsp') as LspWatcher;
  watcher.on('watcher:ready', async () => {
    // const stream = fg.stream([`${CWD}/features/**/*.sql`], { dot: true });
    // for await (const entry of stream) await reloadSQL(pool, entry);

    await fs.ensureDir('dist/tasks');

    // start the HTTP server
    [app, server] = await start({ port, database });
  });

  // files other than `.ts` have changed
  watcher.on('change', async ({ relativePath: filePath }) => {
    console.clear();
    console.log(color`  {underline ${filePath}} {green reloaded}`);
    const extension = extname(filePath);

    const timestamp = Date.now();
    switch (extension) {
      case '.css':
        compileCSS();
        break;
      case '.sql':
        // reloadSQL(pool, filePath);
        // try {
        //   const output = await SQLCompiler.compile(join(CWD, filePath));
        //   const { dir } = parse(filePath);
        //   await fs.outputFile(join(CWD, dir, 'index.ts'), output);
        //   console.log(color`  {underline ${filePath}} {green reloaded}`);
        // } catch (error) {
        //   console.log(
        //     color`  {red.bold Errors:}\n  {grey in} {underline ${filePath}}\n   → ${error.message}`
        //   );
        // }
        break;
      case '.vue':
        VueHandler(filePath, timestamp);
        break;

      default:
        break;
    }
  });

  watcher.on('subsequent:build', async ({ relativePath: filePath, diagnostics }) => {
    console.clear();
    console.log(color`  {underline ${filePath}} {green reloaded}`);
    displayCompilationMessages(diagnostics);

    const { dir, name } = parse(filePath);

    // restart the HTTP server
    sockets.filter(socket => !socket.destroyed).forEach(socket => socket.destroy());
    sockets = [];

    server.close(async () => {
      [app, server] = await start({ port, database });
    });

    // clean the `require` cache
    const cacheKey = `${join(CWD, 'dist', dir, name)}.js`;
    delete require.cache[cacheKey];

    if (dir.includes('Service')) {
      makeRemoteService(app, dir, name);
    }
  });

  const { diagnostics } = watcher.watch(['config', 'features', 'stylesheets'], { ignored: [] });

  displayCompilationMessages(diagnostics);

  //compileCSS();
};

const getDependencies = () => {
  const packageJSONPath = join(process.cwd(), 'package.json');
  const packageJSONContent = require(packageJSONPath);

  const dependencies = Object.keys(packageJSONContent.dependencies)
    .filter(item => ExcludedDependencies.indexOf(item) < 0)

  return dependencies;
}

const displayCompilationMessages = (messages) => {
  if (messages.length > 0) console.log(color`  {red.bold Errors:}`);
  messages.forEach(({ file, messageText }) => {
    const location = file.fileName.split(`${CWD}${sep}`)[1];
    const msg = (messageText as DiagnosticMessageChain).messageText || messageText;
    console.log(
      color`  {grey in} {underline ${location}}\n   → ${msg}`
    );
  });
}

const makeRemoteService = async (app, dir, name) => {
  const interfaceFile = await fs.readFile(`${join(CWD, dir, 'index')}.ts`, 'utf-8');
  const results = parser(interfaceFile);
  const [_interface, methods] = Object.entries(results).shift();
  const feature = _interface.split('Service').shift();

  const generatedClient = generateWebRPCOnClient(feature, methods as RemoteMethodList);
  await fs.writeFile(join(CWD, 'features', feature, 'Caller.ts'), generatedClient);

  const compiledModule = `${join(CWD, 'dist', dir, name)}.js`;
  const serviceClass = require(compiledModule).default;
  const service = new serviceClass()

  // TODO add removal of routes
  for (const [method, { input, output }] of Object.entries(methods)) {
    app.add('POST', `/rpc/${feature}/${method}`, async () => {
      const result = await service[method]();
      return JSONPayload(result, 200);
    });
  }
}

const compileCSS = async () => {
  const { transformers } = require(join(CWD, 'config', 'css.config'));

  try {
    const content = await fs.readFile(join(CWD, 'stylesheets', 'main.css'));
    const { css } = await postcss(transformers).process(content, {
      from: 'stylesheets/main.css',
      to: 'main.css',
      map: { inline: true },
    });

    fs.outputFile(join(CWD, 'public', 'main.css'), css);
  } catch (error) {
    if (error.name === 'CssSyntaxError') {
      console.error(`  ${error.message}\n${error.showSourceCode()}`);
    } else {
      throw error;
    }
  }
};

module.exports = {
  builder: _ => _
    .option('port', { alias: 'p', default: 5544 })
    .option('production', { type: 'boolean', default: false })
    .option('database', { type: 'boolean' })
    .default('dir', '.'),
  handler,
};
