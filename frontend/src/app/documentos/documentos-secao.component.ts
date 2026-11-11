import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { dataHoraBr } from '../core/datas';
import { AGORA, descarteUrgente, textoDescarte } from '../core/descarte';
import { EstadoConsentimento } from '../pacientes/consentimento.service';
import { dataBr } from '../pacientes/pacientes.page';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import {
  DocumentoResumo,
  DocumentosService,
  ROTULO_STATUS,
  ROTULO_TIPO,
  StatusDocumento,
  TOM_STATUS,
} from './documentos.service';

// Secoes "Prontuario" (so APROVADOS) e "Rascunhos" do detalhe do paciente: so metadados (o texto
// so abre na tela de leitura). A pagina so a cria depois de saber o estado do consentimento e
// as duas listas carregam em sequencia (aprovados, depois rascunhos): nunca ha chamadas simultaneas.
@Component({
  selector: 'app-documentos-secao',
  imports: [RouterLink, ButtonComponent, PillComponent],
  templateUrl: './documentos-secao.component.html',
  styleUrl: './documentos-secao.component.scss',
})
export class DocumentosSecaoComponent implements OnInit {
  readonly pacienteId = input.required<string>();
  readonly consentimento = input.required<EstadoConsentimento>();
  // As duas listas terminaram (com ou sem erro): a pagina pode pedir a proxima secao.
  readonly carregada = output<void>();
  private readonly servico = inject(DocumentosService);
  private readonly agora = inject(AGORA);

  readonly dataBr = dataBr;
  readonly dataHora = dataHoraBr;
  readonly tipo = ROTULO_TIPO;
  readonly status = ROTULO_STATUS;
  readonly tom = TOM_STATUS;
  readonly aprovados = signal<DocumentoResumo[] | null>(null);
  readonly rascunhos = signal<DocumentoResumo[] | null>(null);
  readonly erroAprovados = signal(false);
  readonly erroRascunhos = signal(false);

  // Aviso de descarte do rascunho (so rascunho tem prazo). Calculado ao renderizar, sem timer.
  descarte(d: DocumentoResumo): string | null {
    return textoDescarte(d.descarteEm, this.agora());
  }

  urgente(d: DocumentoResumo): boolean {
    return descarteUrgente(d.descarteEm, this.agora());
  }

  ngOnInit(): void {
    this.carregar('APROVADO', () => this.carregar('RASCUNHO', () => this.carregada.emit()));
  }

  carregar(status: StatusDocumento, depois?: () => void): void {
    const [lista, erro] =
      status === 'APROVADO'
        ? [this.aprovados, this.erroAprovados]
        : [this.rascunhos, this.erroRascunhos];
    erro.set(false);
    this.servico.listar(this.pacienteId(), status).subscribe({
      next: (l) => {
        lista.set(l);
        depois?.();
      },
      // 401 e 403 (senha provisoria) o interceptor ja trata; aqui rede, 5xx e 404.
      error: () => {
        erro.set(true);
        depois?.();
      },
    });
  }
}
