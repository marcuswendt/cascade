/// <reference types="vite/client" />

// Vite ?raw import support
declare module '*.ts?raw' {
  const content: string;
  export default content;
}

declare module '*.js?raw' {
  const content: string;
  export default content;
}
