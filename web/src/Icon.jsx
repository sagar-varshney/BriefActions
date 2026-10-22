import React from 'react';
import {ArrowRightIcon} from '@phosphor-icons/react/dist/csr/ArrowRight';
import {ArrowUpRightIcon} from '@phosphor-icons/react/dist/csr/ArrowUpRight';
import {CalendarBlankIcon} from '@phosphor-icons/react/dist/csr/CalendarBlank';
import {CaretDownIcon} from '@phosphor-icons/react/dist/csr/CaretDown';
import {ChartBarIcon} from '@phosphor-icons/react/dist/csr/ChartBar';
import {CheckIcon} from '@phosphor-icons/react/dist/csr/Check';
import {ClockCounterClockwiseIcon} from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import {CopyIcon} from '@phosphor-icons/react/dist/csr/Copy';
import {DownloadSimpleIcon} from '@phosphor-icons/react/dist/csr/DownloadSimple';
import {EqualsIcon} from '@phosphor-icons/react/dist/csr/Equals';
import {FileTextIcon} from '@phosphor-icons/react/dist/csr/FileText';
import {LightningIcon} from '@phosphor-icons/react/dist/csr/Lightning';
import {PencilSimpleIcon} from '@phosphor-icons/react/dist/csr/PencilSimple';
import {PlusIcon} from '@phosphor-icons/react/dist/csr/Plus';
import {QuotesIcon} from '@phosphor-icons/react/dist/csr/Quotes';
import {SunIcon} from '@phosphor-icons/react/dist/csr/Sun';
import {SpinnerGapIcon} from '@phosphor-icons/react/dist/csr/SpinnerGap';
import {UserIcon} from '@phosphor-icons/react/dist/csr/User';
import {UsersIcon} from '@phosphor-icons/react/dist/csr/Users';
import {WarningCircleIcon} from '@phosphor-icons/react/dist/csr/WarningCircle';
import {XIcon} from '@phosphor-icons/react/dist/csr/X';

const icons={arrow:ArrowRightIcon,external:ArrowUpRightIcon,calendar:CalendarBlankIcon,chevron:CaretDownIcon,chart:ChartBarIcon,check:CheckIcon,history:ClockCounterClockwiseIcon,copy:CopyIcon,download:DownloadSimpleIcon,unchanged:EqualsIcon,extract:FileTextIcon,flow:LightningIcon,changed:PencilSimpleIcon,added:PlusIcon,quote:QuotesIcon,day:SunIcon,spinner:SpinnerGapIcon,owner:UserIcon,owners:UsersIcon,attention:WarningCircleIcon,cancelled:XIcon};

export default function Icon({name,size=20,className=''}){
 const Symbol=icons[name];
 return Symbol?<Symbol size={size} weight="regular" className={`ui-icon ${className}`.trim()} aria-hidden="true" focusable="false"/>:null;
}
