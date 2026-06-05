export interface PrinterTransport {
  type: string;
  connect(existingDevice?: any): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
}

export class SerialPrinterTransport implements PrinterTransport {
  type = 'serial';
  port: any | null = null;
  async connect(existingPort?: any) {
    this.port = existingPort || await (navigator as any).serial.requestPort();
    await this.port.open({ baudRate: 9600 });
  }
  async disconnect() {
    if (this.port) await this.port.close();
  }
  async write(data: Uint8Array) {
    if (!this.port || !this.port.writable) throw new Error('Port not writable');
    const writer = this.port.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }
}

export class UsbPrinterTransport implements PrinterTransport {
  type = 'usb';
  device: any | null = null;
  outEndpoint: number = -1;
  async connect(existingDevice?: any) {
    this.device = existingDevice || await (navigator as any).usb.requestDevice({ filters: [] });
    await this.device.open();
    if (this.device.configuration === null) await this.device.selectConfiguration(1);
    await this.device.claimInterface(0);
    const iface = this.device.configuration.interfaces[0];
    const alt = iface.alternates[0];
    for (const ep of alt.endpoints) {
      if (ep.direction === 'out' && ep.type === 'bulk') {
        this.outEndpoint = ep.endpointNumber;
      }
    }
  }
  async disconnect() {
    if (this.device) await this.device.close();
  }
  async write(data: Uint8Array) {
    if (!this.device || this.outEndpoint === -1) throw new Error('USB Device not connected');
    await this.device.transferOut(this.outEndpoint, data);
  }
}

export class NetworkPrinterTransport implements PrinterTransport {
  type = 'network';
  socket: WebSocket | null = null;
  ip: string;
  
  constructor(ip: string) {
    this.ip = ip;
  }
  
  async connect() {
    return new Promise<void>((resolve, reject) => {
      try {
        let wsUrl = this.ip;
        if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
          wsUrl = 'ws://' + wsUrl;
        }
        this.socket = new WebSocket(wsUrl);
        this.socket.binaryType = 'arraybuffer';
        
        const timeout = setTimeout(() => {
          if (this.socket) this.socket.close();
          reject(new Error('Connection timed out'));
        }, 5000);
        
        this.socket.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        
        this.socket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }
  
  async disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
  
  async write(data: Uint8Array) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.socket.send(data as unknown as Blob);
  }
}

export class BrowserPrinterTransport implements PrinterTransport {
  type = 'browser';
  async connect() {}
  async disconnect() {}
  async write(_data: Uint8Array) {}
}
