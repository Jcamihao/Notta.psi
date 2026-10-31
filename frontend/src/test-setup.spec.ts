import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

// App e zoneless: todo teste precisa do mesmo provider.
beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

// Testes de componente leem estilo computado: sem transicao, o valor final vale na hora.
const semTransicao = document.createElement('style');
semTransicao.textContent = '*, *::before { transition: none !important; }';
document.head.append(semTransicao);
