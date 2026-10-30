import { Component } from '@angular/core';

// Moldura das telas publicas (login e cadastro): formulario de um lado, promessa de sigilo do outro.
// So afirma o que o produto garante: chave por clinica, acesso so aos proprios pacientes, aprovacao humana.
@Component({
  selector: 'app-acesso',
  template: `
    <main class="acesso-principal">
      <div class="acesso-coluna">
        <p class="marca">Notta<span class="marca-psi">.psi</span></p>
        <ng-content />
      </div>
    </main>
    <aside class="acesso-sigilo" aria-labelledby="sigilo-titulo">
      <div class="acesso-coluna">
        <h2 id="sigilo-titulo">Feito para o sigilo clínico</h2>
        <dl>
          <div>
            <dt>Chave própria da clínica</dt>
            <dd>O conteúdo clínico é cifrado com uma chave exclusiva da sua clínica.</dd>
          </div>
          <div>
            <dt>Cada um vê o que é seu</dt>
            <dd>
              Cada psicólogo acessa só os próprios pacientes. Nem quem administra a clínica lê
              prontuários de colegas.
            </dd>
          </div>
          <div>
            <dt>Você aprova, sempre</dt>
            <dd>A IA só propõe rascunhos. Nada entra no prontuário sem a sua revisão.</dd>
          </div>
        </dl>
      </div>
    </aside>
  `,
  styles: `
    :host {
      display: grid;
      min-height: 100vh;
      min-height: 100dvh;
    }
    .acesso-principal {
      display: grid;
      align-items: center;
      padding: var(--espaco-6) var(--espaco-5);
    }
    .acesso-coluna {
      width: 100%;
      max-width: 26rem;
      margin-inline: auto;
    }
    .acesso-sigilo {
      display: grid;
      align-items: center;
      padding: var(--espaco-6) var(--espaco-5);
      color: var(--cor-sigilo-texto);
      background: var(--cor-sigilo);
    }
    h2 {
      margin: 0 0 var(--espaco-5);
      font-size: var(--texto-lg);
      font-weight: 600;
      line-height: 1.3;
      text-wrap: balance;
    }
    dl {
      display: grid;
      gap: var(--espaco-4);
      margin: 0;
    }
    dl > div {
      padding-top: var(--espaco-4);
      border-top: 1px solid var(--cor-sigilo-linha);
    }
    dt {
      font-weight: 600;
    }
    dd {
      margin: var(--espaco-1) 0 0;
      color: var(--cor-sigilo-suave);
      font-size: var(--texto-sm);
      line-height: 1.55;
    }
    @media (min-width: 60rem) {
      :host {
        grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
      }
      .acesso-sigilo {
        padding-inline: var(--espaco-7);
      }
      h2 {
        font-size: var(--texto-xl);
      }
    }
  `,
})
export class AcessoComponent {}
