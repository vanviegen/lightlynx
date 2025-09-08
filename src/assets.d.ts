// Asset type declarations
declare module '*.webp' {
    const src: string;
    export = src;
}

declare module '*.png' {
    const src: string;
    export = src;
}

// Worker type declarations
declare module '*.ts?worker&url' {
    const src: string;
    export = src;
}

declare module '*.js?worker&url' {
    const src: string;
    export = src;
}
