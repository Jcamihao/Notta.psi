import { Component } from '@angular/core';
import { KeyRound, LucideAngularModule, ShieldCheck, UserCheck } from 'lucide-angular';

// Moldura das telas publicas (login e cadastro): formulario de um lado, promessa de sigilo do outro.
// So afirma o que o produto garante: chave por clinica, acesso so aos proprios pacientes, aprovacao humana.
@Component({
  selector: 'app-acesso',
  imports: [LucideAngularModule],
  template: `
    <main class="acesso-principal">
      <div class="acesso-coluna">
        <p class="marca">Notta.psi</p>
        <ng-content />
      </div>
    </main>
    <aside class="acesso-sigilo" aria-labelledby="sigilo-titulo">
      <div class="acesso-coluna">
        <h2 id="sigilo-titulo">Feito para o sigilo clínico</h2>
        <dl>
          <div>
            <dt>
              <span class="chip chip-rosa"
                ><lucide-icon [img]="icones.KeyRound" [size]="13" [strokeWidth]="1.5"
              /></span>
              Chave própria da clínica
            </dt>
            <dd>O conteúdo clínico é cifrado com uma chave exclusiva da sua clínica.</dd>
          </div>
          <div>
            <dt>
              <span class="chip chip-azul"
                ><lucide-icon [img]="icones.UserCheck" [size]="13" [strokeWidth]="1.5"
              /></span>
              Cada um vê o que é seu
            </dt>
            <dd>
              Cada psicólogo acessa só os próprios pacientes. Nem quem administra a clínica lê
              prontuários de colegas.
            </dd>
          </div>
          <div>
            <dt>
              <span class="chip chip-amarelo"
                ><lucide-icon [img]="icones.ShieldCheck" [size]="13" [strokeWidth]="1.5"
              /></span>
              Você aprova, sempre
            </dt>
            <dd>A IA só propõe rascunhos. Nada entra no prontuário sem a sua revisão.</dd>
          </div>
        </dl>
      </div>
    </aside>
  `,
  // Painel de sigilo na superficie escura do sistema (#141414) com texto creme (16.5:1) e
  // detalhe em #A9A49B (7.4:1). Flutua com a mesma margem e raio da sidebar do app.
  styles: `
    :host {
      display: grid;
      gap: 22px;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 22px 24px;
    }
    .acesso-principal {
      display: grid;
      align-items: center;
      padding: var(--space-9) 0;
    }
    .acesso-coluna {
      width: 100%;
      max-width: 26rem;
      margin-inline: auto;
    }
    .acesso-sigilo {
      display: grid;
      align-items: center;
      padding: var(--space-9) var(--space-8);
      color: var(--cream-100);
      background: var(--bg-sidebar);
      border-radius: var(--radius-panel);
    }
    h2 {
      margin: 0 0 var(--space-9);
      font-size: 26px;
      letter-spacing: var(--ls-display);
      text-wrap: balance;
    }
    dl {
      display: grid;
      gap: var(--space-8);
      margin: 0;
    }
    .chip {
      display: grid;
      flex: none;
      place-items: center;
      width: var(--size-icon-chip);
      height: var(--size-icon-chip);
      color: var(--ink-900);
      border-radius: 50%;
    }
    .chip-rosa {
      background: var(--pink-300);
    }
    .chip-azul {
      background: var(--blue-300);
    }
    .chip-amarelo {
      background: var(--yellow-300);
    }
    dt {
      display: flex;
      align-items: center;
      gap: var(--space-5);
      font-weight: var(--fw-medium);
    }
    dd {
      margin: var(--space-1) 0 0 calc(var(--size-icon-chip) + var(--space-5));
      color: var(--ink-300);
    }
    @media (min-width: 60rem) {
      :host {
        grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
        gap: 36px;
      }
      .acesso-sigilo {
        padding-inline: 56px;
      }
      h2 {
        font-size: var(--fs-logo);
      }
    }
    @media (max-width: 30rem) {
      :host {
        padding: var(--space-5);
      }
    }
  `,
})
export class AcessoComponent {
  readonly icones = { KeyRound, ShieldCheck, UserCheck };
}
