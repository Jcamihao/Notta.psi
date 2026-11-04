import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { dataHoraBr } from '../core/datas';
import { EstadoConsentimento } from '../pacientes/consentimento.service';
import { dataBr } from '../pacientes/pacientes.page';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import {
  DocumentoResumo,
  DocumentosService,
  ROTULO_STATUS,
  ROTULO_TIPO,
  TOM_STATUS,
} from './documentos.service';

// Secao "Documentos" do detalhe do paciente: so metadados (o texto so abre na tela de leitura).
// A pagina so a cria depois de saber o estado do consentimento: nunca ha chamadas simultaneas.
@Component({
  selector: 'app-documentos-secao',
  imports: [RouterLink, ButtonComponent, PillComponent],
  templateUrl: './documentos-secao.component.html',
  styleUrl: './documentos-secao.component.scss',
})
export class DocumentosSecaoComponent implements OnInit {
  readonly pacienteId = input.required<string>();
  readonly consentimento = input.required<EstadoConsentimento>();
  private readonly servico = inject(DocumentosService);

  readonly dataBr = dataBr;
  readonly dataHora = dataHoraBr;
  readonly tipo = ROTULO_TIPO;
  readonly status = ROTULO_STATUS;
  readonly tom = TOM_STATUS;
  readonly lista = signal<DocumentoResumo[] | null>(null);
  readonly erroLista = signal(false);

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.erroLista.set(false);
    this.servico.listar(this.pacienteId()).subscribe({
      next: (l) => this.lista.set(l),
      // 401 e 403 (senha provisoria) o interceptor ja trata; aqui rede, 5xx e 404.
      error: () => this.erroLista.set(true),
    });
  }
}
