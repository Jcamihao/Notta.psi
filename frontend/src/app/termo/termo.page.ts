import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CircleAlert, LucideAngularModule } from 'lucide-angular';
import { ButtonComponent } from '../ui/button.component';
import { WordmarkComponent } from '../ui/wordmark.component';
import { TermoPublico, TermoService } from './termo.service';

type Tela = 'carregando' | 'pronto' | 'aceito' | 'recusado' | 'invalido' | 'falha';

const TITULO = 'Termo de consentimento';

// Pagina publica do termo (/termo/:token): fora do shell, sem login, sem dado do paciente. O token
// e a credencial: fica so na URL desta pagina e no caminho das requisicoes; nada de console,
// storage ou analytics. Link invalido, expirado, cancelado ou usado = a MESMA tela generica.
@Component({
  selector: 'app-termo-page',
  imports: [LucideAngularModule, ButtonComponent, RouterLink, WordmarkComponent],
  templateUrl: './termo.page.html',
  styleUrl: './termo.page.scss',
})
export class TermoPage implements OnInit {
  readonly icones = { CircleAlert };
  private readonly servico = inject(TermoService);
  private readonly rota = inject(ActivatedRoute);
  private readonly meta = inject(Meta);
  private readonly titulo = inject(Title);
  private readonly documento = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  readonly tela = signal<Tela>('carregando');
  readonly dados = signal<TermoPublico | null>(null);
  readonly recusando = signal(false);
  readonly enviando = signal(false);
  readonly erro = signal('');
  readonly falhaMensagem = signal('');

  private token = '';

  ngOnInit(): void {
    this.cabecalho();
    this.token = this.rota.snapshot.paramMap.get('token') ?? '';
    this.carregar();
  }

  carregar(): void {
    this.tela.set('carregando');
    this.servico.abrir(this.token).subscribe({
      next: (d) => {
        this.dados.set(d);
        this.tela.set('pronto');
      },
      error: (e: HttpErrorResponse) => {
        // Qualquer 404/400 = mesmo texto, sem distinguir o motivo.
        if (e.status === 404 || e.status === 400) this.mostrar('invalido');
        else {
          this.falhaMensagem.set(this.mensagemErro(e));
          this.tela.set('falha');
        }
      },
    });
  }

  aceitar(): void {
    this.enviar(() => this.servico.aceitar(this.token), 'aceito');
  }

  pedirRecusa(): void {
    this.erro.set('');
    this.recusando.set(true);
    this.focar('termo-voltar');
  }

  voltar(): void {
    this.recusando.set(false);
    this.focar('termo-recusar');
  }

  recusar(): void {
    this.enviar(() => this.servico.recusar(this.token), 'recusado');
  }

  private enviar(chamar: () => ReturnType<TermoService['aceitar']>, depois: Tela): void {
    if (this.enviando()) return;
    this.erro.set('');
    this.enviando.set(true);
    chamar().subscribe({
      next: () => {
        this.enviando.set(false);
        this.recusando.set(false);
        this.mostrar(depois);
      },
      error: (e: HttpErrorResponse) => {
        this.enviando.set(false);
        if (e.status === 404) {
          this.recusando.set(false);
          this.mostrar('invalido');
        } else this.erro.set(this.mensagemErro(e));
      },
    });
  }

  private mensagemErro(e: HttpErrorResponse): string {
    return e.status === 429
      ? 'Muitas tentativas agora. Aguarde um minuto e tente de novo.'
      : 'Não foi possível concluir agora. Confira sua conexão e tente de novo.';
  }

  // Telas de resultado: o foco vai ao titulo, que o leitor de tela le junto do texto (role=status).
  private mostrar(tela: Tela): void {
    this.tela.set(tela);
    this.focar('termo-foco');
  }

  private focar(id: string): void {
    afterNextRender(() => this.documento.getElementById(id)?.focus(), {
      injector: this.injector,
    });
  }

  // Titulo neutro, sem indexacao e sem Referer, so enquanto a pagina existe. O cabecalho
  // `X-Robots-Tag` no servidor continua sendo o reforco certo (a SPA so le isto ao rodar JS).
  private cabecalho(): void {
    const anterior = this.titulo.getTitle();
    this.titulo.setTitle(TITULO);
    const tags = [
      this.meta.addTag({ name: 'robots', content: 'noindex' }),
      this.meta.addTag({ name: 'referrer', content: 'no-referrer' }),
    ];
    this.destroyRef.onDestroy(() => {
      this.titulo.setTitle(anterior);
      for (const t of tags) if (t) this.meta.removeTagElement(t);
    });
  }
}
