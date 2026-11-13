import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ArrowLeft, LucideAngularModule } from 'lucide-angular';
import { dataHoraBr } from '../core/datas';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import {
  Evento,
  LinhaDoTempoService,
  PacienteNaoEncontrado,
  agruparPorMes,
  dataValida,
} from './linha-do-tempo.service';

type Filtro = 'TUDO' | 'DOCUMENTOS' | 'CONSENTIMENTO';

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: 'TUDO', rotulo: 'Tudo' },
  { valor: 'DOCUMENTOS', rotulo: 'Documentos' },
  { valor: 'CONSENTIMENTO', rotulo: 'Consentimento' },
];

const DO_FILTRO: Record<Filtro, (e: Evento) => boolean> = {
  TUDO: () => true,
  DOCUMENTOS: (e) => e.tipo === 'DOCUMENTO',
  CONSENTIMENTO: (e) => e.tipo === 'CONSENTIMENTO' || e.tipo === 'TERMO',
};

// Linha do tempo de um paciente. So tipo, estado e datas; o filtro vive so num signal (nao vai para
// URL, storage nem history.state). As leituras saem em sequencia dentro do servico.
@Component({
  selector: 'app-linha-do-tempo-page',
  imports: [LucideAngularModule, RouterLink, ButtonComponent, PillComponent],
  templateUrl: './linha-do-tempo.page.html',
  styleUrl: './linha-do-tempo.page.scss',
})
export class LinhaDoTempoPage {
  readonly icones = { ArrowLeft };
  readonly filtros = FILTROS;
  readonly dataHora = dataHoraBr;
  readonly valida = dataValida;
  private readonly servico = inject(LinhaDoTempoService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly rota = inject(ActivatedRoute);
  readonly pacienteId = signal('');

  readonly nome = signal('');
  readonly eventos = signal<Evento[]>([]);
  readonly carregando = signal(true);
  readonly erro = signal(false);
  readonly filtro = signal<Filtro>('TUDO');

  // Grupos por mes do filtro escolhido. "atual" marca o primeiro item visivel (o mais recente).
  readonly grupos = computed(() => {
    const visiveis = this.eventos().filter(DO_FILTRO[this.filtro()]);
    let primeiro = true;
    return agruparPorMes(visiveis).map((g) => ({
      chave: g.chave,
      rotulo: g.rotulo,
      itens: g.eventos.map((ev) => {
        const atual = primeiro;
        primeiro = false;
        return { ev, atual };
      }),
    }));
  });
  readonly vazioTotal = computed(
    () => !this.carregando() && !this.erro() && this.eventos().length === 0,
  );
  readonly vazioFiltro = computed(() => this.eventos().length > 0 && this.grupos().length === 0);

  // Cada carga ganha um numero; resposta de carga antiga (ou depois de sair da tela) e ignorada.
  private geracao = 0;

  constructor() {
    this.destroyRef.onDestroy(() => this.geracao++);
    // /pacientes/a/linha-do-tempo -> /pacientes/b/linha-do-tempo reaproveita o componente.
    this.rota.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      this.pacienteId.set(p.get('id')!);
      this.nome.set('');
      this.eventos.set([]);
      this.filtro.set('TUDO');
      this.carregar();
    });
  }

  carregar(): void {
    const minha = ++this.geracao;
    this.carregando.set(true);
    this.erro.set(false);
    this.servico.carregar(this.pacienteId()).then(
      (r) => {
        if (minha !== this.geracao) return;
        this.nome.set(r.nome);
        this.eventos.set(r.eventos);
        this.carregando.set(false);
      },
      (e: unknown) => {
        if (minha !== this.geracao) return;
        this.carregando.set(false);
        // Paciente excluido ou de outro psicologo: a lista explica, nada desta tela fica visivel.
        if (e instanceof PacienteNaoEncontrado) {
          void this.router.navigateByUrl('/pacientes', {
            state: { aviso: 'nao-encontrado-exclusao' },
          });
          return;
        }
        // Qualquer outra falha: mensagem fixa, sem corpo de erro.
        this.erro.set(true);
      },
    );
  }
}
