import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { ChevronDown, CircleAlert, CircleCheck, LucideAngularModule, Search } from 'lucide-angular';
import { filter, map } from 'rxjs';
import { AvatarComponent } from '../ui/avatar.component';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import { filtrarPacientes, FiltroConsentimento } from './busca-pacientes';
import { OPCOES_POR_PAGINA, paginar, POR_PAGINA_PADRAO, PorPagina } from './paginacao';
import { ROTULO_CONSENTIMENTO, TOM_CONSENTIMENTO } from './consentimento.service';
import { Paciente, PacientesService } from './pacientes.service';

// Mesmo valor de TETO_LISTA em backend/src/pacientes/pacientes.service.ts: o servidor entrega no
// maximo 500 pacientes, e a busca so procura entre eles. Se mudar um, mude o outro.
export const LIMITE_LISTA = 500;

// Recado que a tela anterior deixa no state da navegacao (so um codigo fixo, nunca dado de
// paciente: o state vai para o historico do navegador).
export type AvisoPacientes = 'criado' | 'nao-encontrado' | 'excluido' | 'nao-encontrado-exclusao';

// 'YYYY-MM-DD' -> 'DD/MM/AAAA' sem passar por Date (new Date('1990-05-17') mostra o dia anterior
// no Brasil).
export function dataBr(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

@Component({
  selector: 'app-pacientes-page',
  imports: [LucideAngularModule, RouterLink, AvatarComponent, ButtonComponent, PillComponent],
  templateUrl: './pacientes.page.html',
  styleUrl: './pacientes.page.scss',
})
export class PacientesPage {
  readonly icones = { ChevronDown, CircleAlert, CircleCheck, Search };
  private readonly servico = inject(PacientesService);
  private readonly router = inject(Router);

  readonly dataBr = dataBr;
  readonly rotulo = ROTULO_CONSENTIMENTO;
  readonly tom = TOM_CONSENTIMENTO;
  readonly limite = LIMITE_LISTA;
  readonly lista = signal<Paciente[] | null>(null);
  readonly erroLista = signal(false);

  // Busca e filtro so em signals: nunca em URL, storage, history.state ou console (sigilo).
  readonly termo = signal('');
  readonly estado = signal<FiltroConsentimento>('TODOS');
  readonly filtrosConsentimento: { valor: FiltroConsentimento; rotulo: string }[] = [
    { valor: 'TODOS', rotulo: 'Todos' },
    { valor: 'CONCEDIDO', rotulo: ROTULO_CONSENTIMENTO.CONCEDIDO },
    { valor: 'NENHUM', rotulo: ROTULO_CONSENTIMENTO.NENHUM },
    { valor: 'REVOGADO', rotulo: ROTULO_CONSENTIMENTO.REVOGADO },
  ];
  readonly temFiltro = computed(() => this.termo().trim() !== '' || this.estado() !== 'TODOS');
  readonly filtrados = computed(() =>
    filtrarPacientes(this.lista() ?? [], this.termo(), this.estado()),
  );
  readonly campoBusca = viewChild<ElementRef<HTMLInputElement>>('campoBusca');
  readonly contagem = viewChild<ElementRef<HTMLElement>>('contagem');

  // Paginacao no navegador, sobre a lista ja filtrada. Pagina e tamanho so em signals (sigilo).
  readonly opcoesPorPagina = OPCOES_POR_PAGINA;
  readonly menorOpcao = OPCOES_POR_PAGINA[0];
  readonly pagina = signal(1);
  readonly porPagina = signal<PorPagina>(POR_PAGINA_PADRAO);
  // A pagina pedida pode passar do fim (lista encolheu): paginar() devolve a pagina valida.
  readonly pag = computed(() => paginar(this.filtrados(), this.pagina(), this.porPagina()));
  readonly aviso = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(
        () =>
          (this.router.lastSuccessfulNavigation?.extras.state?.['aviso'] as
            AvisoPacientes | undefined) ?? null,
      ),
    ),
    { initialValue: null },
  );

  constructor() {
    this.carregar();
  }

  aoDigitar(evento: Event): void {
    this.termo.set((evento.target as HTMLInputElement).value);
    this.pagina.set(1);
  }

  escolherFiltro(valor: FiltroConsentimento): void {
    this.estado.set(valor);
    this.pagina.set(1);
  }

  aoMudarPorPagina(evento: Event): void {
    const valor = Number((evento.target as HTMLSelectElement).value);
    const escolhida = OPCOES_POR_PAGINA.find((o) => o === valor) ?? POR_PAGINA_PADRAO;
    this.porPagina.set(escolhida);
    this.pagina.set(1);
  }

  // Anterior/Proxima: o botao pode ficar desabilitado no clique, entao o foco vai para a contagem
  // (topo da lista) em vez de se perder.
  irPara(delta: -1 | 1): void {
    this.pagina.set(this.pag().pagina + delta);
    const contagem = this.contagem()?.nativeElement;
    if (!contagem) return;
    contagem.focus({ preventScroll: true });
    const topo = contagem.getBoundingClientRect().top;
    if (topo < 0 || topo > window.innerHeight) {
      contagem.scrollIntoView({ block: 'nearest' });
    }
  }

  limpar(): void {
    this.termo.set('');
    this.estado.set('TODOS');
    this.pagina.set(1);
    // O campo continua no DOM: zera o valor e devolve o foco para ele.
    const campo = this.campoBusca()?.nativeElement;
    if (campo) {
      campo.value = '';
      campo.focus();
    }
  }

  carregar(): void {
    this.erroLista.set(false);
    this.servico.listar().subscribe({
      next: (l) => this.lista.set(l),
      // 401 e 403 (senha provisoria) o interceptor ja trata; aqui so a falha de rede ou 5xx.
      error: () => this.erroLista.set(true),
    });
  }
}
