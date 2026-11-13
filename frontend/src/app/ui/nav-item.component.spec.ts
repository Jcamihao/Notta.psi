import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { LogOut, Users } from 'lucide-angular';
import { NavItemComponent } from './nav-item.component';

@Component({
  imports: [NavItemComponent, RouterLink, RouterLinkActive],
  template: `
    <a
      app-nav-item
      routerLink="/equipe"
      routerLinkActive
      ariaCurrentWhenActive="page"
      [icon]="equipe"
    >
      Equipe
    </a>
    <button app-nav-item type="button" [icon]="sair">Sair</button>
  `,
})
class Host {
  equipe = Users;
  sair = LogOut;
}

describe('NavItemComponent', () => {
  it('link com icone e rotulo; ativo = aria-current, azul da marca e barra de 2px', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'equipe', children: [] }])],
    });
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    const a = f.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(a.textContent?.trim()).toBe('Equipe');
    expect(a.getAttribute('href')).toBe('/equipe');
    expect(a.querySelector('svg')).not.toBeNull();
    expect(getComputedStyle(a).color).toBe('rgb(255, 255, 255)');
    await TestBed.inject(Router).navigateByUrl('/equipe');
    await f.whenStable();
    expect(a.getAttribute('aria-current')).toBe('page');
    expect(getComputedStyle(a).color).toBe('rgb(56, 182, 255)');
    expect(getComputedStyle(a, '::before').width).toBe('2px');
  });

  it('tambem serve num button (Sair)', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    const b = f.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(b.textContent?.trim()).toBe('Sair');
    expect(b.type).toBe('button');
  });
});
