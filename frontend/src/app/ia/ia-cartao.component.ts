import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { dataHoraBr } from '../core/datas';
import { ConsentimentoService, EstadoConsentimento } from '../pacientes/consentimento.service';
import { ButtonComponent } from '../ui/button.component';
import { IaService, UsoIa } from './ia.service';

// Cartao "Gerar com IA" da nota bruta. Duas chamadas em sequencia (uso da IA, depois o
// consentimento do paciente); a pagina de leitura so o cria depois de carregar o documento.
@Component({
  selector: 'app-ia-cartao',
  imports: [RouterLink, ButtonComponent],
  templateUrl: './ia-cartao.component.html',
  styleUrl: './ia-cartao.component.scss',
})
export class IaCartaoComponent implements OnInit {
  readonly pacienteId = input.required<string>();
  readonly docId = input.required<string>();
  private readonly ia = inject(IaService);
  private readonly consentimentos = inject(ConsentimentoService);

  readonly uso = signal<UsoIa | null>(null);
  readonly consentimento = signal<EstadoConsentimento | null>(null);
  readonly erroCarga = signal(false);
  readonly noLimite = computed(() => {
    const u = this.uso();
    return !!u && u.usadas >= u.limite;
  });
  readonly dataHora = dataHoraBr;

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.erroCarga.set(false);
    this.ia.uso().subscribe({
      next: (u) => {
        this.uso.set(u);
        // IA desligada: nem pergunta do consentimento.
        if (!u.habilitada) return;
        this.consentimentos.obter(this.pacienteId()).subscribe({
          next: (c) => this.consentimento.set(c.estado),
          error: () => this.erroCarga.set(true),
        });
      },
      // 401 e 403 (senha provisoria) o interceptor ja trata; aqui rede e 5xx.
      error: () => this.erroCarga.set(true),
    });
  }
}
