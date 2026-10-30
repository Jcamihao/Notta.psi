import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

// App e zoneless: todo teste precisa do mesmo provider.
beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));
