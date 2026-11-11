import { InjectionToken } from '@angular/core';

// Dispara o download de um blob com um <a download> criado por codigo. A URL do blob e revogada
// logo depois do clique (mesmo se o clique falhar): o conteudo nao fica referenciado na pagina.
export function baixarArquivo(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  try {
    a.href = url;
    a.download = nome;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
  } finally {
    a.remove();
    URL.revokeObjectURL(url);
  }
}

// Ponto de injecao para as telas que baixam arquivo; o teste troca por um espiao.
export const BAIXAR_ARQUIVO = new InjectionToken<(blob: Blob, nome: string) => void>(
  'BAIXAR_ARQUIVO',
  { providedIn: 'root', factory: () => baixarArquivo },
);
