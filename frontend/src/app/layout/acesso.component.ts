import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { KeyRound, LucideAngularModule, ShieldCheck, UserCheck } from 'lucide-angular';

// Moldura das telas publicas (login e cadastro): formulario de um lado, promessa de sigilo do outro.
// Cada frase do painel precisa continuar verdadeira segundo seguranca.conteudo.ts (ids):
//   item 1 (dados cifrados, chave por clinica): `cifra`; nao diz "exclusiva" porque o servidor decifra para exibir.
//   item 2 (cada um ve o seu, RLS FORCE): `isolamento`.
//   item 3 (IA so propoe rascunho, troca por codigos, aprovacao humana, envio a terceiros): `ia` e `aprovado`.
// O link leva a /seguranca, onde estao os limites e o que ainda nao esta pronto.
@Component({
  selector: 'app-acesso',
  imports: [LucideAngularModule, RouterLink],
  template: `
    <main class="acesso-principal">
      <div class="acesso-coluna">
        <p class="marca">praxis.psi</p>
        <ng-content />
      </div>
    </main>
    <aside class="acesso-sigilo" aria-labelledby="sigilo-titulo">
      <div class="acesso-coluna">
        <h2 id="sigilo-titulo">Feito para o sigilo clínico</h2>
        <dl>
          <div>
            <dt>
              <span class="chip chip-acento"
                ><lucide-icon [img]="icones.KeyRound" [size]="13" [strokeWidth]="1.5"
              /></span>
              Dados cifrados, com chave por clínica
            </dt>
            <dd>
              Nome, nascimento, telefone e e-mail do paciente e o texto dos documentos ficam
              cifrados no banco, com uma chave própria de cada clínica.
            </dd>
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
            <dd>
              A IA só propõe rascunhos e só é usada para pacientes com consentimento. Antes de
              enviar, o sistema troca o nome do paciente, CPF, telefone, e-mail e endereço com
              número por códigos (o filtro reduz o risco, mas não é perfeito) e você confere o
              texto. Nada entra no prontuário sem a sua aprovação. O texto vai a um serviço de IA de
              terceiros, só depois da sua confirmação.
            </dd>
          </div>
        </dl>
        <p class="sigilo-link">
          <a routerLink="/seguranca">Veja o que protegemos e o que ainda não está pronto</a>
        </p>
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
    .chip-acento {
      background: var(--accent);
    }
    .chip-azul {
      background: var(--blue-300);
    }
    .chip-amarelo {
      background: var(--yellow-300);
    }
    .sigilo-link {
      margin: var(--space-8) 0 0;
    }
    .sigilo-link a {
      color: var(--ink-300);
      text-underline-offset: 3px;
    }
    .sigilo-link a:focus-visible {
      outline-color: var(--accent);
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
