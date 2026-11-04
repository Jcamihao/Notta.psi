import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ArrowLeft, LucideAngularModule } from 'lucide-angular';
import { dataHoraBr } from '../core/datas';
import { AvisoDetalhe } from '../pacientes/paciente-form.page';
import { dataBr } from '../pacientes/pacientes.page';
import { ButtonComponent } from '../ui/button.component';
import { PillComponent } from '../ui/pill.component';
import {
  Documento,
  DocumentosService,
  ROTULO_STATUS,
  ROTULO_TIPO,
  TOM_STATUS,
} from './documentos.service';

// Leitura do documento (sem edicao: edicao e o item 14). O texto vive so neste signal e e
// mostrado por interpolacao (nunca innerHTML); sai da memoria ao sair da pagina.
@Component({
  selector: 'app-documento-leitura-page',
  imports: [LucideAngularModule, RouterLink, ButtonComponent, PillComponent],
  templateUrl: './documento-leitura.page.html',
  styleUrl: './documento-leitura.page.scss',
})
export class DocumentoLeituraPage implements OnDestroy {
  readonly icones = { ArrowLeft };
  private readonly servico = inject(DocumentosService);
  private readonly router = inject(Router);
  private readonly rota = inject(ActivatedRoute).snapshot.paramMap;
  readonly pacienteId = this.rota.get('id')!;
  private readonly docId = this.rota.get('docId')!;

  readonly dataBr = dataBr;
  readonly dataHora = dataHoraBr;
  readonly tipo = ROTULO_TIPO;
  readonly status = ROTULO_STATUS;
  readonly tom = TOM_STATUS;
  readonly documento = signal<Documento | null>(null);
  readonly erroCarga = signal(false);

  constructor() {
    this.carregar();
  }

  carregar(): void {
    this.erroCarga.set(false);
    this.servico.obter(this.pacienteId, this.docId).subscribe({
      next: (d) => this.documento.set(d),
      error: (e: HttpErrorResponse) => {
        if (e.status === 404) this.voltar('documento-nao-encontrado');
        // 401 e 403 (senha provisoria) o interceptor ja trata; aqui rede, 5xx e 400.
        else this.erroCarga.set(true);
      },
    });
  }

  ngOnDestroy(): void {
    this.documento.set(null);
  }

  private voltar(aviso: AvisoDetalhe): void {
    void this.router.navigateByUrl(`/pacientes/${this.pacienteId}`, { state: { aviso } });
  }
}
