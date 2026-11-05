import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { dataHoraBr } from '../core/datas';
import { ROTULO_TIPO } from '../documentos/documentos.service';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import { Geracao, IaService, ROTULO_GERACAO, TOM_GERACAO } from './ia.service';

// Secao "Pedidos de IA" do detalhe do paciente: para quem fechou o app e voltou, ver onde o
// pedido parou. So metadados (nunca texto). Previas que nao foram enviadas ficam de fora (nada
// saiu do sistema). Sem pedidos, a secao nem aparece: clinica que nao usa IA nao ve ruido.
@Component({
  selector: 'app-pedidos-ia-secao',
  imports: [RouterLink, ButtonComponent, PillComponent],
  templateUrl: './pedidos-ia-secao.component.html',
  styleUrl: './pedidos-ia-secao.component.scss',
})
export class PedidosIaSecaoComponent implements OnInit {
  readonly pacienteId = input.required<string>();
  private readonly ia = inject(IaService);

  readonly tipo = ROTULO_TIPO;
  readonly rotulo = ROTULO_GERACAO;
  readonly tom = TOM_GERACAO;
  readonly dataHora = dataHoraBr;
  readonly pedidos = signal<Geracao[] | null>(null);
  readonly erro = signal(false);

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.erro.set(false);
    this.ia.listar(this.pacienteId()).subscribe({
      next: (l) => this.pedidos.set(l.filter((g) => g.estado !== 'PREVIA')),
      // 401 e 403 (senha provisoria) o interceptor ja trata; aqui rede, 5xx e 404.
      error: () => this.erro.set(true),
    });
  }
}
