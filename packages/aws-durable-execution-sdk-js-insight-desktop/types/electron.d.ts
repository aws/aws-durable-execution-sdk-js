/**
 * Minimal ambient declarations for the slice of Electron this PoC uses, so the
 * package type-checks and bundles without `electron` installed in the workspace
 * (installing it triggers an unrelated monorepo peer-dep conflict — see README).
 * When electron IS installed, its own richer types take precedence.
 */
declare module "electron" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;

  export interface IpcMainEvent {
    sender: WebContents;
  }
  export interface WebContents {
    send(channel: string, ...args: Any[]): void;
  }
  export interface BrowserWindowOptions {
    width?: number;
    height?: number;
    title?: string;
    icon?: string | NativeImage;
    webPreferences?: {
      preload?: string;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
    };
  }
  export class BrowserWindow {
    constructor(opts?: BrowserWindowOptions);
    webContents: WebContents;
    loadURL(url: string): Promise<void>;
    static getAllWindows(): BrowserWindow[];
  }
  export const app: {
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: Any[]) => void): void;
    quit(): void;
    getPath(name: string): string;
    dock?: { setIcon(image: NativeImage): void };
    isPackaged: boolean;
  };
  export interface NativeImage {
    isEmpty(): boolean;
  }
  export const nativeImage: {
    createFromPath(path: string): NativeImage;
  };
  export const ipcMain: {
    on(
      channel: string,
      listener: (event: IpcMainEvent, ...args: Any[]) => void,
    ): void;
  };
  export const dialog: {
    showSaveDialog(
      opts: Any,
    ): Promise<{ canceled: boolean; filePath?: string }>;
    showOpenDialog(
      opts: Any,
    ): Promise<{ canceled: boolean; filePaths: string[] }>;
    showMessageBox(opts: Any): Promise<{ response: number }>;
  };
  export const protocol: {
    registerSchemesAsPrivileged(list: Any[]): void;
    handle(
      scheme: string,
      handler: (req: Request) => Response | Promise<Response>,
    ): void;
  };
  export const contextBridge: {
    exposeInMainWorld(key: string, api: Any): void;
  };
  export const ipcRenderer: {
    send(channel: string, ...args: Any[]): void;
    on(channel: string, listener: (event: Any, ...args: Any[]) => void): void;
  };
}
