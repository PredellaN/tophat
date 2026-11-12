// Copyright (C) 2026 Todd Kulesza <todd@dropline.net>
//
// This file is part of TopHat.
//
// TopHat is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// TopHat is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with TopHat. If not, see <https://www.gnu.org/licenses/>.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';

import {
  ExtensionMetadata,
  gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import { CapacityBar } from './capacity.js';
import {
  DisplayType,
  getDisplayTypeSetting,
  GBytesToHumanString,
} from './helpers.js';
import { HistoryChart } from './history.js';
import { Orientation } from './meter.js';
import { TopHatMonitor, MeterNoVal } from './monitor.js';
import { Vitals } from './vitals.js';

export const GpuMonitor = GObject.registerClass(
  class GpuMonitor extends TopHatMonitor {
    private usage;
    private menuGpuUsage;
    private menuGpuCap;
    private menuGpuModel;
    private menuGpuPower;
    private menuGpuStatus;
    private menuGpuMemUsage;
    private menuGpuMemCap;
    private menuGpuMemSize;
    private displayType: DisplayType;
    private absUnits: boolean;

    constructor(metadata: ExtensionMetadata, gsettings: Gio.Settings) {
      super('GPU Monitor', metadata, gsettings);

      const gicon = Gio.icon_new_for_string(
        `${this.metadata.path}/icons/hicolor/scalable/actions/gpu-icon-symbolic.svg`
      );
      this.icon.set_gicon(gicon);

      this.usage = new St.Label({
        text: MeterNoVal,
        style_class: 'tophat-panel-usage',
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.add_child(this.usage);

      this.meter.setNumBars(1);
      this.meter.setOrientation(Orientation.Vertical);
      this.add_child(this.meter);

      this.menuGpuUsage = new St.Label();
      this.menuGpuCap = new CapacityBar();
      this.menuGpuModel = new St.Label();
      this.menuGpuPower = new St.Label();
      this.menuGpuStatus = new St.Label();
      this.menuGpuMemUsage = new St.Label();
      this.menuGpuMemCap = new CapacityBar();
      this.menuGpuMemSize = new St.Label();
      this.historyChart = new HistoryChart();

      this.displayType = this.updateDisplayType();
      let id = this.gsettings.connect('changed::gpu-display', () => {
        this.updateDisplayType();
      });
      this.settingsSignals.push(id);

      this.absUnits = gsettings.get_boolean('gpu-mem-abs-units');
      id = this.gsettings.connect(
        'changed::gpu-mem-abs-units',
        (settings: Gio.Settings) => {
          this.absUnits = settings.get_boolean('gpu-mem-abs-units');
          this.vitals?.notify('gpu-usage');
          this.vitals?.notify('gpu-mem-used');
        }
      );
      this.settingsSignals.push(id);

      this.visible = gsettings.get_boolean('show-gpu');
      id = this.gsettings.connect(
        'changed::show-gpu',
        (settings: Gio.Settings) => {
          this.visible = settings.get_boolean('show-gpu');
        }
      );
      this.settingsSignals.push(id);

      this.buildMenu();
      this.addMenuButtons();
      this.updateColor();
    }

    private updateDisplayType() {
      this.displayType = getDisplayTypeSetting(this.gsettings, 'gpu-display');
      if (this.displayType === DisplayType.Both) {
        this.usage.show();
        this.meter.show();
      } else if (this.displayType === DisplayType.Chart) {
        this.usage.hide();
        this.meter.show();
      } else {
        this.usage.show();
        this.meter.hide();
      }
      return this.displayType;
    }

    private buildMenu() {
      let label = new St.Label({
        text: _('GPU usage'),
        style_class: 'tophat-menu-header',
      });
      this.addMenuRow(label, 0, 2, 1);

      label = new St.Label({
        text: _('GPU utilization:'),
        style_class: 'tophat-menu-label',
      });
      this.addMenuRow(label, 0, 1, 1);
      this.menuGpuUsage.text = MeterNoVal;
      this.menuGpuUsage.add_style_class_name('tophat-menu-value');
      this.addMenuRow(this.menuGpuUsage, 1, 1, 1);
      this.addMenuRow(this.menuGpuCap, 0, 2, 1);

      this.menuGpuModel.text = _(`model ${MeterNoVal}`);
      this.menuGpuModel.add_style_class_name(
        'tophat-menu-label tophat-menu-details'
      );
      this.menuGpuModel.set_x_expand(true);
      this.addMenuRow(this.menuGpuModel, 0, 2, 1);

      label = new St.Label({
        text: _('Status:'),
        style_class: 'tophat-menu-label tophat-menu-details',
      });
      this.addMenuRow(label, 0, 1, 1);
      this.menuGpuStatus.text = MeterNoVal;
      this.menuGpuStatus.add_style_class_name(
        'tophat-menu-value tophat-menu-details'
      );
      this.addMenuRow(this.menuGpuStatus, 1, 1, 1);

      label = new St.Label({
        text: _('Power draw:'),
        style_class:
          'tophat-menu-label tophat-menu-details tophat-menu-section-end',
      });
      this.addMenuRow(label, 0, 1, 1);
      this.menuGpuPower.text = MeterNoVal;
      this.menuGpuPower.add_style_class_name(
        'tophat-menu-value tophat-menu-details tophat-menu-section-end'
      );
      this.addMenuRow(this.menuGpuPower, 1, 1, 1);

      label = new St.Label({
        text: _('GPU memory'),
        style_class: 'tophat-menu-header',
      });
      this.addMenuRow(label, 0, 2, 1);

      label = new St.Label({
        text: _('Memory used:'),
        style_class: 'tophat-menu-label',
      });
      this.addMenuRow(label, 0, 1, 1);
      this.menuGpuMemUsage.text = MeterNoVal;
      this.menuGpuMemUsage.add_style_class_name('tophat-menu-value');
      this.addMenuRow(this.menuGpuMemUsage, 1, 1, 1);
      this.addMenuRow(this.menuGpuMemCap, 0, 2, 1);

      this.menuGpuMemSize.text = _(`size ${MeterNoVal}`);
      this.menuGpuMemSize.add_style_class_name(
        'tophat-menu-details align-right tophat-menu-section-end'
      );
      this.addMenuRow(this.menuGpuMemSize, 0, 2, 1);

      if (this.historyChart) {
        this.addMenuRow(this.historyChart, 0, 2, 1);
      }
    }

    protected override addMenuButtons() {
      const appSys = Shell.AppSystem.get_default();
      const nvidiaApp = appSys.lookup_app('nvidia-settings.desktop');
      if (nvidiaApp) {
        const button = new St.Button({ style_class: 'button' });
        button.child = new St.Icon({
          icon_name: 'nvidia-settings',
          fallback_icon_name: 'preferences-system-symbolic',
        });
        button.connect('clicked', () => {
          this.menu.close(true);
          nvidiaApp.activate();
        });
        this.menuActionBox.add_child(button);
      }
      super.addMenuButtons();
    }

    public override bindVitals(vitals: Vitals): void {
      super.bindVitals(vitals);

      let id = vitals.connect('notify::gpu-usage', () => {
        const percent = (vitals.gpu_usage * 100).toFixed(0) + '%';
        if (!this.absUnits) {
          this.usage.text = percent;
        }
        this.menuGpuUsage.text = percent;
        this.meter.setBarSizes([vitals.gpu_usage]);
        this.menuGpuCap.setUsage(vitals.gpu_usage);
      });
      this.vitalsSignals.push(id);

      id = vitals.connect('notify::gpu-power', () => {
        if (vitals.gpu_status === 'suspended') {
          this.menuGpuPower.text = _('0 W (Suspended)');
        } else {
          this.menuGpuPower.text = `${vitals.gpu_power.toFixed(1)} W`;
        }
      });
      this.vitalsSignals.push(id);

      id = vitals.connect('notify::gpu-model', () => {
        this.menuGpuModel.text = vitals.gpu_model || _('NVIDIA GPU');
      });
      this.vitalsSignals.push(id);

      id = vitals.connect('notify::gpu-status', () => {
        this.menuGpuStatus.text =
          vitals.gpu_status === 'suspended' ? _('Suspended') : _('Active');
      });
      this.vitalsSignals.push(id);

      id = vitals.connect('notify::gpu-mem-usage', () => {
        const percent = (vitals.gpu_mem_usage * 100).toFixed(0) + '%';
        this.menuGpuMemUsage.text = percent;
        this.menuGpuMemCap.setUsage(vitals.gpu_mem_usage);
      });
      this.vitalsSignals.push(id);

      const updateMemSize = () => {
        const used = GBytesToHumanString(vitals.gpu_mem_used);
        const free = GBytesToHumanString(vitals.gpu_mem_free);
        const total = GBytesToHumanString(vitals.gpu_mem_total);
        this.menuGpuMemSize.text = _(
          `${used} used, ${free} available of ${total}`
        );
        if (this.absUnits) {
          this.usage.text = used;
        }
      };

      id = vitals.connect('notify::gpu-mem-used', updateMemSize);
      this.vitalsSignals.push(id);

      id = vitals.connect('notify::gpu-mem-free', updateMemSize);
      this.vitalsSignals.push(id);

      id = vitals.connect('notify::gpu-mem-total', updateMemSize);
      this.vitalsSignals.push(id);

      id = vitals.connect('notify::gpu-history', () => {
        this.historyChart?.update(vitals.getGpuHistory());
      });
      this.vitalsSignals.push(id);
    }
  }
);

export type GpuMonitor = InstanceType<typeof GpuMonitor>;
