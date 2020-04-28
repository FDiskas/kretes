declare module 'kretes' {
  import { ReadStream } from 'fs';

  interface Request {
    params: {
      [name: string]: any
    },
    files: {
      [name: string]: {
        name: string
        length: number
        data: any
        encoding: string
        mimetype: string
      }
    }
  }

  type Response = string | { body: string } | Buffer | ReadStream;
  type Handler = (request: Request) => Response | Promise<Response>;

  interface Resource {
    feature: string
    alias?: string
    children?: Resource[]
  };

  interface Routes {
    DELETE?: {
      [name: string]: Handler
    },
    GET?: {
      [name: string]: Handler
    },
    HEAD?: {
      [name: string]: Handler
    },
    OPTIONS?: {
      [name: string]: Handler
    }
    PATCH?: {
      [name: string]: Handler
    },
    POST?: {
      [name: string]: Handler
    },
    PUT?: {
      [name: string]: Handler
    },
    Resources?: Resource[]
  }

  interface Payload {
    [key: string]: any
  }
  type Task = (input: Payload) => Promise<void>;
  type Queue = any;

  export { Handler, Routes, Request, Response, Payload, Task }
}

declare module 'kretes/response' {
  import { Response } from 'kretes';

  interface Mapping {
    [key: string]: any;
  }

  function OK(body?: any, headers?: any): Response;
  function Created(body?: any, headers?: any): Response;
  function NotFound(headers?: any): Response;
  function HTMLString(body?: any): Response;
  function HTMLStream(body?: any): Response;
  function Page(location: string, mapping: Mapping): Response;

  export { OK, Created, NotFound, HTMLString, HTMLStream, Page };
}

declare module 'kretes/background' {
  import { Task, Payload, Queue } from 'kretes';

  interface ScheduleInput {
    task: Task
    payload?: Payload
    queue?: Queue
    runAt?: string
    maxAttempts?: number
  }

  function schedule(_: ScheduleInput): Promise<void>;
}

declare module 'kretes/db' {
  interface SQLStatement {
    text: string
    values: (string | number)[]
  }

  function execute(statement: SQLStatement);
  // FIXME ugly hack
  function from(table: string);
}

declare module 'kretes/auth' {
  import { Handler } from 'kretes';

  function login(finder?: any): Handler
  function register(table?: any): Handler
  function authenticate(action: any): Handler
}

// FIXME hacks, because I don't want to mix TS/JS and CJS/MJS
// one way of doing things

declare module 'autoprefixer';
declare module 'tailwindcss';
